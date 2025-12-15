// services/billingService.js - FIXED VERSION
// Unified payment tracking with proper synchronization

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
   * FIXED: Proper insurance handling and duplicate prevention
   */
  async createInvoice(data, userId) {
    try {
      // === DUPLICATE CHECK WITH BETTER ERROR HANDLING ===
      if (data.visit) {
        const existingInvoice = await Invoice.findOne({ visit: data.visit });
        
        if (existingInvoice) {
          logger.warn(`Invoice already exists for visit ${data.visit}: ${existingInvoice.invoiceNumber}`);
          // Return existing invoice instead of creating duplicate
          return existingInvoice;
        }
      }

      // Fetch patient to check insurance
      const patient = await Patient.findById(data.patient)
        .populate('insurance.provider');
      
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
      
      // Calculate initial totals
      invoice.calculateTotals();

      // === UNIFIED INSURANCE LOGIC ===
      if (hasInsurance) {
        const now = new Date();
        
        // Get provider ObjectId
        let providerObjectId = patient.insurance.provider;
        if (typeof patient.insurance.provider === 'string') {
          const insuranceProvider = await InsuranceProvider.findOne({ 
            name: { $regex: new RegExp(`^${patient.insurance.provider}$`, 'i') }
          });
          
          if (!insuranceProvider) {
            throw new Error(`Insurance provider "${patient.insurance.provider}" not found`);
          }
          
          providerObjectId = insuranceProvider._id;
          
          // Update patient record
          patient.insurance.provider = insuranceProvider._id;
          await patient.save();
        }

        // Mark all items as paid and covered by insurance
        invoice.items.forEach(item => {
          item.paid = true;
          item.paidAt = now;
          item.coveredByInsurance = true;
          item.insuranceApproved = true;
        });
        
        // Add insurance payment record
        invoice.payments.push({
          amount: invoice.totalAmount,
          method: 'insurance',
          paidBy: userId,
          paidAt: now,
          reference: `Insurance payment - ${patient.insurance.membershipNumber || 'N/A'}`,
          notes: '100% insurance coverage',
          itemIndices: invoice.items.map((_, index) => index)
        });

        // Set insurance coverage details
        invoice.insuranceCoverage = {
          provider: providerObjectId,
          policyNumber: patient.insurance.membershipNumber || 'N/A',
          coverageAmount: invoice.totalAmount,
          status: 'approved',
          approvalCode: `AUTO-${Date.now()}`
        };

        // Update invoice status
        invoice.status = 'paid';
        invoice.amountPaid = invoice.totalAmount;
        invoice.balanceDue = 0;
        invoice.paidDate = now;

        logger.info(`Invoice ${invoiceNumber} auto-paid (100% insurance coverage) for patient ${patient._id}`);
      }
      
      // Save invoice (calculateTotals runs in pre-save hook)
      await invoice.save();

      // === SYNC WITH GLOBAL PAYMENT MODEL ===
      if (hasInsurance && invoice.payments.length > 0) {
        await this._createGlobalPaymentRecord(invoice, invoice.payments[0], userId);
      }

      // Update visit status if applicable
      if (data.visit) {
        await this._updateVisitAfterInvoiceCreation(data.visit, invoice, hasInsurance);
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
   * FIXED: Proper insurance handling
   */
  async addItemsToInvoice(invoiceId, items, hasInsurance = false) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      const now = new Date();
      const newItemIndices = [];

      // Add new items
      items.forEach((item, index) => {
        const itemIndex = invoice.items.length;
        invoice.items.push({
          ...item,
          paid: hasInsurance,
          paidAt: hasInsurance ? now : null,
          coveredByInsurance: hasInsurance,
          insuranceApproved: hasInsurance
        });
        newItemIndices.push(itemIndex);
      });

      // If insured, add payment for new items
      if (hasInsurance) {
        const newItemsTotal = items.reduce((sum, item) => sum + item.total, 0);
        
        invoice.payments.push({
          amount: newItemsTotal,
          method: 'insurance',
          paidAt: now,
          reference: `Insurance payment for additional services`,
          notes: 'Automatic insurance coverage',
          itemIndices: newItemIndices
        });

        // Update insurance coverage amount
        if (invoice.insuranceCoverage) {
          invoice.insuranceCoverage.coverageAmount += newItemsTotal;
        }
      }

      // Save will trigger calculateTotals via pre-save hook
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
   * FIXED: Synchronized with invoice payments array
   */
  async processPayment(paymentData, userId) {
    try {
      // Get invoice
      const invoice = await Invoice.findById(paymentData.invoice);
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      // Validate payment amount
      if (paymentData.amount > invoice.balanceDue) {
        throw new Error('Payment amount exceeds balance due');
      }
      
      // Generate payment number
      const paymentNumber = await Payment.generatePaymentNumber();
      
      // Create global payment record
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
      
      // === SYNC: Update invoice if payment successful ===
      if (payment.status === 'completed') {
        // Use the legacy addPayment method which handles item marking
        invoice.addPayment(payment.amount);
        await invoice.save();
        
        await this.sendPaymentReceipt(payment, invoice);
      }

      // Check if consultation was paid and update visit
      if (payment.status === 'completed' && invoice.visit) {
        await this._checkAndUpdateVisitStatus(invoice);
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
   * UNCHANGED - Working correctly
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
   * UNCHANGED - Working correctly
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
   * UNCHANGED - Working correctly
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
   * FIXED: Syncs with invoice payments array
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
      
      // === SYNC: Update invoice ===
      const invoice = await Invoice.findById(payment.invoice);
      if (invoice) {
        // Remove the refunded amount from payments
        const refundPayment = {
          amount: -refundData.amount, // Negative amount for refund
          method: payment.method,
          paidBy: userId,
          paidAt: new Date(),
          reference: `Refund for payment ${payment.paymentNumber}`,
          notes: refundData.reason
        };
        
        invoice.payments.push(refundPayment);
        
        // Save triggers recalculation
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

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Create global Payment record that syncs with invoice
   */
  async _createGlobalPaymentRecord(invoice, paymentData, userId) {
    try {
      const paymentNumber = await Payment.generatePaymentNumber();
      
      const payment = new Payment({
        paymentNumber,
        invoice: invoice._id,
        patient: invoice.patient,
        amount: paymentData.amount,
        method: paymentData.method,
        paymentDate: paymentData.paidAt,
        processedBy: userId,
        reference: paymentData.reference,
        notes: paymentData.notes,
        status: 'completed'
      });
      
      await payment.save();
      logger.info(`Created global payment record ${paymentNumber} for invoice ${invoice.invoiceNumber}`);
      
      return payment;
    } catch (error) {
      logger.error('Create global payment record error:', error);
      // Don't throw - this is supplementary
    }
  }

  /**
   * Update visit status after invoice creation
   */
  async _updateVisitAfterInvoiceCreation(visitId, invoice, hasInsurance) {
    try {
      const visit = await Visit.findById(visitId).populate('patient');
      
      if (!visit) return;

      visit.invoice = invoice._id;
      visit.consultationFeeAmount = invoice.items.find(i => i.type === 'consultation')?.total || 0;

      if (hasInsurance) {
        visit.status = 'In Queue';
        visit.consultationFeePaid = true;
        logger.info(`Visit ${visit.visitId} moved to queue (insurance coverage)`);
      } else {
        visit.status = 'Pending Payment';
        visit.consultationFeePaid = false;
      }

      await visit.save();
    } catch (error) {
      logger.error('Update visit after invoice creation error:', error);
      // Don't throw - this is supplementary
    }
  }

  /**
   * Check and update visit status after payment
   */
  async _checkAndUpdateVisitStatus(invoice) {
    try {
      const visit = await Visit.findById(invoice.visit).populate('patient');
      
      if (!visit) return;

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
    } catch (error) {
      logger.error('Check and update visit status error:', error);
      // Don't throw - this is supplementary
    }
  }

  // ===== UTILITY METHODS =====

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
