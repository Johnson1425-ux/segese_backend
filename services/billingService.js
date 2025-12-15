// services/billingService.js - UPDATED VERSION
// Simplified insurance logic with proper ObjectId handling

import mongoose from 'mongoose';
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
   * IMPORTANT: Checks if invoice already exists for visit to prevent duplicates
   */
  async createInvoice(data, userId) {
    try {
      // === DUPLICATE CHECK ===
      if (data.visit) {
        const existingInvoice = await Invoice.findOne({ visit: data.visit });
        
        if (existingInvoice) {
          logger.warn(`Invoice already exists for visit ${data.visit}: ${existingInvoice.invoiceNumber}`);
          return existingInvoice;
        }
      }

      // Fetch patient to check insurance
      const patient = await Patient.findById(data.patient);
      if (!patient) {
        throw new Error('Patient not found');
      }

      const hasInsurance = !!(patient.insurance?.provider);

      // Generate invoice number
      const invoiceNumber = await Invoice.generateInvoiceNumber();
      
      // Calculate due date based on payment terms
      const dueDate = this.calculateDueDate(data.paymentTerms || 'immediate');
      
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

      // === SIMPLIFIED INSURANCE LOGIC ===
      if (hasInsurance) {
        const now = new Date();
        
        // Mark all items as paid
        invoice.items.forEach(item => {
          item.paid = true;
          item.paidAt = now;
        });
        
        invoice.status = 'paid';
        invoice.amountPaid = invoice.totalAmount;
        invoice.balanceDue = 0;
        invoice.paidDate = now;

        // Handle insurance provider reference
        let providerObjectId = patient.insurance.provider;

        // If it's a string (provider name), look it up
        if (typeof patient.insurance.provider === 'string') {
          const insuranceProvider = await InsuranceProvider.findOne({ 
            name: { $regex: new RegExp(`^${patient.insurance.provider}$`, 'i') }
          });
          
          if (!insuranceProvider) {
            // Get list of available providers
            const availableProviders = await InsuranceProvider.find({ isActive: true })
              .select('name')
              .limit(10);
            
            const providerNames = availableProviders.map(p => p.name).join(', ');
            
            throw new Error(
              `Insurance provider "${patient.insurance.provider}" not found. ` +
              `Available providers: ${providerNames}`
            );
          }
          
          providerObjectId = insuranceProvider._id;
          
          // Update patient record with ObjectId for future use
          patient.insurance.provider = insuranceProvider._id;
          await patient.save();
          logger.info(`Auto-migrated patient ${patient._id} insurance provider to ObjectId`);
        }

        // Add insurance coverage info (100% coverage)
        invoice.insuranceCoverage = {
          provider: providerObjectId,
          policyNumber: patient.insurance.membershipNumber || 'N/A',
          coverageAmount: invoice.totalAmount,
          status: 'approved'
        };

        logger.info(`Invoice ${invoiceNumber} auto-paid (100% insurance coverage) for patient ${patient._id}`);
      }
      
      // Save invoice
      await invoice.save();

      // Update visit status for insured patients
      if (invoice.status === 'paid' && data.visit) {
        const visit = await Visit.findById(data.visit);
        if (visit && visit.status === 'Pending Payment') {
          visit.status = 'In Queue';
          visit.consultationFeePaid = true;
          visit.invoice = invoice._id;
          await visit.save();
          logger.info(`Visit ${visit.visitId} moved to queue (insurance coverage)`);
        }
      }
      
      // Link invoice to visit for non-insured
      if (!hasInsurance && data.visit) {
        const visit = await Visit.findById(data.visit);
        if (visit) {
          visit.invoice = invoice._id;
          await visit.save();
        }
      }
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'CREATE',
        entityType: 'Invoice',
        entityId: invoice._id,
        description: `Created invoice ${invoiceNumber} for patient${hasInsurance ? ' (auto-paid by insurance)' : ''}`,
        metadata: { 
          invoiceNumber, 
          amount: invoice.totalAmount,
          hasInsurance,
          status: invoice.status
        }
      });
      
      // Send notification to patient
      await Notification.createNotification({
        recipient: invoice.patient,
        type: 'system_announcement',
        title: hasInsurance ? 'Invoice Covered by Insurance' : 'New Invoice Generated',
        message: hasInsurance 
          ? `Invoice ${invoiceNumber} of Tsh. ${invoice.totalAmount.toLocaleString()} has been covered by your insurance.`
          : `Invoice ${invoiceNumber} has been generated with amount Tsh. ${invoice.totalAmount.toLocaleString()}`,
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

  /**
   * Add items to existing invoice
   */
  async addItemsToInvoice(invoiceId, items, hasInsurance = false) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Add new items - mark as paid if patient has insurance
      const now = new Date();
      items.forEach(item => {
        invoice.items.push({
          ...item,
          paid: hasInsurance,
          paidAt: hasInsurance ? now : null
        });
      });

      // Recalculate totals
      invoice.calculateTotals();

      // If insured, keep everything as paid (100% coverage)
      if (hasInsurance) {
        invoice.status = 'paid';
        invoice.amountPaid = invoice.totalAmount;
        invoice.balanceDue = 0;
        
        // Update insurance coverage amount
        if (invoice.insuranceCoverage) {
          invoice.insuranceCoverage.coverageAmount = invoice.totalAmount;
        }
      }

      await invoice.save();

      logger.info(`Added ${items.length} item(s) to invoice ${invoice.invoiceNumber}${hasInsurance ? ' (covered by insurance)' : ''}`);

      return invoice;
    } catch (error) {
      logger.error('Add items to invoice error:', error);
      throw error;
    }
  }

  /**
   * Process payment for invoice
   */
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
        const gatewayResponse = await this.processCardPayment(paymentData);
        payment.transactionId = gatewayResponse.transactionId;
        payment.gatewayResponse = gatewayResponse;
        payment.status = gatewayResponse.success ? 'completed' : 'failed';
      } else if (paymentData.method === 'online') {
        const gatewayResponse = await this.processOnlinePayment(paymentData);
        payment.transactionId = gatewayResponse.transactionId;
        payment.gatewayResponse = gatewayResponse;
        payment.status = gatewayResponse.success ? 'completed' : 'failed';
      } else {
        payment.status = 'completed';
      }
      
      await payment.save();
      
      // Update invoice if payment successful
      if (payment.status === 'completed') {
        invoice.addPayment(payment.amount);
        await invoice.save();
        
        await this.sendPaymentReceipt(payment, invoice);
      }

      // === CHECK CONSULTATION PAYMENT FOR NON-INSURED PATIENTS ===
      if (invoice.visit) {
        const visit = await Visit.findById(invoice.visit).populate('patient');
        
        if (visit) {
          const hasInsurance = !!(visit.patient?.insurance?.provider);
          
          // Only for non-insured patients
          if (!hasInsurance && visit.status === 'Pending Payment') {
            const consultationItem = invoice.items.find(
              item => item.type === 'consultation'
            );
            
            // If consultation item exists and is marked as paid
            if (consultationItem && consultationItem.paid) {
              visit.status = 'In Queue';
              visit.consultationFeePaid = true;
              await visit.save();
              logger.info(`Visit ${visit.visitId} moved to queue after consultation payment`);
            }
          }
        }
      }
      
      // Create audit log
      await AuditLog.log({
        userId,
        action: 'CREATE',
        entityType: 'Payment',
        entityId: payment._id,
        description: `Processed payment ${paymentNumber} of Tsh. ${payment.amount}`,
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
      
      const provider = await InsuranceProvider.findById(insuranceData.providerId);
      if (!provider) {
        throw new Error('Insurance provider not found');
      }
      
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
      
      invoice.insuranceCoverage = {
        provider: provider._id,
        policyNumber: insuranceData.policyNumber,
        coverageAmount: totalCoverage,
        claimNumber: await this.generateClaimNumber(),
        status: 'processing'
      };
      
      invoice.calculateTotals();
      await invoice.save();
      
      if (provider.apiIntegration?.enabled) {
        await this.submitElectronicClaim(invoice, provider);
      }
      
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
      
      await payment.processRefund(
        refundData.amount,
        refundData.reason,
        userId
      );
      
      const invoice = await Invoice.findById(payment.invoice);
      if (invoice) {
        invoice.amountPaid -= refundData.amount;
        invoice.balanceDue += refundData.amount;
        if (invoice.status === 'paid' && invoice.balanceDue > 0) {
          invoice.status = 'partial';
        }
        await invoice.save();
      }
      
      await AuditLog.log({
        userId,
        action: 'UPDATE',
        entityType: 'Payment',
        entityId: payment._id,
        description: `Processed refund of Tsh. ${refundData.amount} for payment ${payment.paymentNumber}`,
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
    return {
      success: true,
      transactionId: `TXN-${Date.now()}`,
      authCode: 'AUTH123',
      message: 'Payment processed successfully'
    };
  }

  async processOnlinePayment(paymentData) {
    return {
      success: true,
      transactionId: `ONL-${Date.now()}`,
      message: 'Online payment processed'
    };
  }

  async processGatewayRefund(gateway, transactionId, amount) {
    return {
      success: true,
      refundTransactionId: `REF-${Date.now()}`,
      message: 'Refund processed successfully'
    };
  }

  async submitElectronicClaim(invoice, provider) {
    logger.info(`Submitting electronic claim for invoice ${invoice.invoiceNumber}`);
    return true;
  }

  async sendPaymentReceipt(payment, invoice) {
    logger.info(`Sending payment receipt for payment ${payment.paymentNumber}`);
    return true;
  }
}

export default new BillingService();
