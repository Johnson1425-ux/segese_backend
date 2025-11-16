import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Patient from '../models/Patient.js';
import Visit from '../models/Visit.js';
import InsuranceProvider from '../models/InsuranceProvider.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

class BillingService {
  /**
   * Create a new invoice
   */
  async createInvoice(data, userId) {
    try {
      // Generate invoice number
      const invoiceNumber = await Invoice.generateInvoiceNumber();
      
      // Calculate due date based on payment terms
      const dueDate = this.calculateDueDate(data.paymentTerms);
      
      // Create invoice
      const invoice = new Invoice({
        ...data,
        invoiceNumber,
        dueDate,
        generatedBy: userId,
        status: 'pending'
      });
      
      // Calculate totals
      invoice.calculateTotals();
      
      // Save invoice
      await invoice.save();
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'CREATE',
        entityType: 'Invoice',
        entityId: invoice._id,
        description: `Created invoice ${invoiceNumber} for patient`,
        metadata: { invoiceNumber, amount: invoice.totalAmount }
      });
      
      // Send notification to patient
      await Notification.createNotification({
        recipient: invoice.patient,
        type: 'system_announcement',
        title: 'New Invoice Generated',
        message: `Invoice ${invoiceNumber} has been generated with amount $${invoice.totalAmount}`,
        relatedEntity: {
          entityType: 'invoice',
          entityId: invoice._id
        }
      });
      
      return invoice;
    } catch (error) {
      logger.error('Create invoice error:', error);
      throw error;
    }
  }

  async processPayment(paymentData, userId) {
    try {
      // Generate payment number
      const paymentNumber = await Payment.generatePaymentNumber();
      
      // Get invoice
      const invoice = await Invoice.findById(paymentData.invoice);
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      // Validate payment amount
      if (paymentData.amount > invoice.balanceDue) {
        throw new Error('Payment amount exceeds balance due');
      }
      
      // Create payment record
      const payment = new Payment({
        ...paymentData,
        paymentNumber,
        processedBy: userId,
        status: 'processing'
      });
      
      // Process payment based on method
      if (paymentData.method === 'credit_card' || paymentData.method === 'debit_card') {
        // Process card payment through gateway
        const gatewayResponse = await this.processCardPayment(paymentData);
        payment.transactionId = gatewayResponse.transactionId;
        payment.gatewayResponse = gatewayResponse;
        payment.status = gatewayResponse.success ? 'completed' : 'failed';
      } else if (paymentData.method === 'online') {
        // Process online payment
        const gatewayResponse = await this.processOnlinePayment(paymentData);
        payment.transactionId = gatewayResponse.transactionId;
        payment.gatewayResponse = gatewayResponse;
        payment.status = gatewayResponse.success ? 'completed' : 'failed';
      } else {
        // Manual payment methods (cash, check, etc.)
        payment.status = 'completed';
      }
      
      // Save payment
      await payment.save();
      
      // Update invoice if payment successful
      if (payment.status === 'completed') {
        invoice.addPayment(payment.amount);
        await invoice.save();
        
        // Send receipt
        await this.sendPaymentReceipt(payment, invoice);
      }

      if (invoice.status === 'paid' && invoice.visit) {
        // 3. Find the visit and update its status to 'In Queue'
        await Visit.findByIdAndUpdate(invoice.visit, { status: 'In Queue' });
        logger.info(`Visit ${invoice.visit} activated for invoice ${invoice.invoiceNumber}`);
      }
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'CREATE',
        entityType: 'Payment',
        entityId: payment._id,
        description: `Processed payment ${paymentNumber} of $${payment.amount}`,
        metadata: { 
          paymentNumber, 
          amount: payment.amount,
          method: payment.method,
          status: payment.status
        }
      });
      
      return payment;
    } catch (error) {
      logger.error('Process payment error:', error);
      throw error;
    }
  }

  /**
   * Process insurance claim
   */
  async processInsuranceClaim(invoiceId, insuranceData, userId) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      // Get insurance provider
      const provider = await InsuranceProvider.findById(insuranceData.providerId);
      if (!provider) {
        throw new Error('Insurance provider not found');
      }
      
      // Calculate coverage
      let totalCoverage = 0;
      for (const item of invoice.items) {
        if (item.coveredByInsurance) {
          const coverage = provider.checkCoverage(
            insuranceData.planCode,
            item.type
          );
          if (coverage) {
            const itemCoverage = (item.total * coverage.coveragePercentage) / 100;
            totalCoverage += itemCoverage;
            item.insuranceApproved = true;
          }
        }
      }
      
      // Update invoice with insurance information
      invoice.insuranceCoverage = {
        provider: provider._id,
        policyNumber: insuranceData.policyNumber,
        coverageAmount: totalCoverage,
        claimNumber: await this.generateClaimNumber(),
        status: 'processing'
      };
      
      invoice.calculateTotals();
      await invoice.save();
      
      // Submit claim to insurance (if API integration enabled)
      if (provider.apiIntegration.enabled) {
        await this.submitElectronicClaim(invoice, provider);
      }
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'UPDATE',
        entityType: 'Invoice',
        entityId: invoice._id,
        description: `Submitted insurance claim for invoice ${invoice.invoiceNumber}`,
        metadata: { 
          claimNumber: invoice.insuranceCoverage.claimNumber,
          coverageAmount: totalCoverage
        }
      });
      
      return invoice;
    } catch (error) {
      logger.error('Process insurance claim error:', error);
      throw error;
    }
  }

  /**
   * Generate billing statement for patient
   */
  async generateStatement(patientId, startDate, endDate) {
    try {
      const invoices = await Invoice.find({
        patient: patientId,
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }).populate('items');
      
      const payments = await Payment.find({
        patient: patientId,
        paymentDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      });
      
      // Calculate totals
      const totalCharges = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
      const totalPayments = payments.reduce((sum, pay) => sum + pay.amount, 0);
      const totalBalance = invoices.reduce((sum, inv) => sum + inv.balanceDue, 0);
      
      return {
        patient: patientId,
        period: { startDate, endDate },
        invoices,
        payments,
        summary: {
          totalCharges,
          totalPayments,
          totalBalance,
          overdueAmount: invoices
            .filter(inv => inv.isOverdue)
            .reduce((sum, inv) => sum + inv.balanceDue, 0)
        }
      };
    } catch (error) {
      logger.error('Generate statement error:', error);
      throw error;
    }
  }

  /**
   * Check for overdue invoices
   */
  async checkOverdueInvoices() {
    try {
      const overdueInvoices = await Invoice.find({
        status: 'pending',
        dueDate: { $lt: new Date() }
      });
      
      for (const invoice of overdueInvoices) {
        invoice.status = 'overdue';
        await invoice.save();
        
        // Send overdue notification
        await Notification.createNotification({
          recipient: invoice.patient,
          type: 'system_announcement',
          title: 'Invoice Overdue',
          message: `Invoice ${invoice.invoiceNumber} is overdue. Please make payment as soon as possible.`,
          priority: 'high',
          relatedEntity: {
            entityType: 'invoice',
            entityId: invoice._id
          }
        });
      }
      
      return overdueInvoices.length;
    } catch (error) {
      logger.error('Check overdue invoices error:', error);
      throw error;
    }
  }

  /**
   * Process refund
   */
  async processRefund(paymentId, refundData, userId) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      // Process refund through payment gateway if applicable
      if (payment.gateway && payment.transactionId) {
        const refundResponse = await this.processGatewayRefund(
          payment.gateway,
          payment.transactionId,
          refundData.amount
        );
        
        if (!refundResponse.success) {
          throw new Error('Gateway refund failed');
        }
        
        refundData.refundTransactionId = refundResponse.refundTransactionId;
      }
      
      // Update payment with refund details
      await payment.processRefund(
        refundData.amount,
        refundData.reason,
        userId
      );
      
      // Update invoice
      const invoice = await Invoice.findById(payment.invoice);
      if (invoice) {
        invoice.amountPaid -= refundData.amount;
        invoice.balanceDue += refundData.amount;
        if (invoice.status === 'paid' && invoice.balanceDue > 0) {
          invoice.status = 'partial';
        }
        await invoice.save();
      }
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'UPDATE',
        entityType: 'Payment',
        entityId: payment._id,
        description: `Processed refund of $${refundData.amount} for payment ${payment.paymentNumber}`,
        metadata: { 
          refundAmount: refundData.amount,
          reason: refundData.reason
        }
      });
      
      return payment;
    } catch (error) {
      logger.error('Process refund error:', error);
      throw error;
    }
  }

  // Helper methods
  calculateDueDate(paymentTerms) {
    const date = new Date();
    const termDays = {
      'immediate': 0,
      'net_15': 15,
      'net_30': 30,
      'net_45': 45,
      'net_60': 60
    };
    
    const days = termDays[paymentTerms] || 0;
    date.setDate(date.getDate() + days);
    return date;
  }

  async generateClaimNumber() {
    const date = new Date();
    const timestamp = date.getTime();
    const random = Math.floor(Math.random() * 1000);
    return `CLM-${timestamp}-${random}`;
  }

  async processCardPayment(paymentData) {
    // Placeholder for actual payment gateway integration
    // This would integrate with Stripe, Square, etc.
    return {
      success: true,
      transactionId: `TXN-${Date.now()}`,
      authCode: 'AUTH123',
      message: 'Payment processed successfully'
    };
  }

  async processOnlinePayment(paymentData) {
    // Placeholder for online payment processing
    return {
      success: true,
      transactionId: `ONL-${Date.now()}`,
      message: 'Online payment processed'
    };
  }

  async processGatewayRefund(gateway, transactionId, amount) {
    // Placeholder for gateway refund processing
    return {
      success: true,
      refundTransactionId: `REF-${Date.now()}`,
      message: 'Refund processed successfully'
    };
  }

  async submitElectronicClaim(invoice, provider) {
    // Placeholder for electronic claim submission
    logger.info(`Submitting electronic claim for invoice ${invoice.invoiceNumber}`);
    return true;
  }

  async sendPaymentReceipt(payment, invoice) {
    // Placeholder for sending payment receipt
    logger.info(`Sending payment receipt for payment ${payment.paymentNumber}`);
    return true;
  }
}

export default new BillingService();
