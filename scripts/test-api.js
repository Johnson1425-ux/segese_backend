import axios from 'axios';
import logger from '../utils/logger.js';

const BASE_URL = 'http://localhost:5000/api';
let authToken = '';

// Test data
const testData = {
  admin: {
    email: 'johnson1425@hospital.com',
    password: 'Admin123!'
  },
  patient: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1234567890',
    dateOfBirth: '1990-05-15',
    gender: 'male',
    bloodType: 'O+',
    address: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'USA'
    }
  },
  doctor: {
    firstName: 'Dr. Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@hospital.com',
    password: 'Doctor123!',
    role: 'doctor',
    department: 'Cardiology',
    phone: '+1234567891',
    dateOfBirth: '1985-03-20',
    gender: 'female',
    specialization: 'Cardiologist'
  },
  appointment: {
    patientId: '',
    doctorId: '',
    appointmentDate: '2024-01-15',
    appointmentTime: '10:00',
    type: 'consultation',
    reason: 'Regular checkup',
    symptoms: ['fatigue', 'mild chest pain']
  },
  visit: {
    patientId: '',
    doctorId: '',
    visitDate: '2024-01-15',
    startTime: '09:00',
    type: 'consultation',
    reason: 'Patient consultation',
    symptoms: ['headache', 'fever']
  }
};

// Helper function to make API calls
const apiCall = async (method, endpoint, data = null, token = null) => {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message,
      status: error.response?.status 
    };
  }
};

// Test functions
const testHealthCheck = async () => {
  logger.info('🔍 Testing Health Check...');
  const result = await apiCall('GET', '/health');
  if (result.success) {
    logger.info('✅ Health check passed');
    return true;
  } else {
    logger.error('❌ Health check failed:', result.error);
    return false;
  }
};

const testAdminLogin = async () => {
  logger.info('🔍 Testing Admin Login...');
  const result = await apiCall('POST', '/auth/login', {
    email: testData.admin.email,
    password: testData.admin.password
  });
  
  if (result.success) {
    authToken = result.data.token;
    logger.info('✅ Admin login successful');
    logger.info(`👤 Logged in as: ${result.data.user.firstName} ${result.data.user.lastName}`);
    return true;
  } else {
    logger.error('❌ Admin login failed:', result.error);
    return false;
  }
};

const testCreatePatient = async () => {
  logger.info('🔍 Testing Create Patient...');
  const result = await apiCall('POST', '/patients', testData.patient, authToken);
  
  if (result.success) {
    testData.patientId = result.data._id;
    logger.info('✅ Patient created successfully');
    logger.info(`👤 Patient ID: ${result.data.patientId}`);
    return true;
  } else {
    logger.error('❌ Create patient failed:', result.error);
    return false;
  }
};

const testGetPatients = async () => {
  logger.info('🔍 Testing Get Patients...');
  const result = await apiCall('GET', '/patients', null, authToken);
  
  if (result.success) {
    logger.info('✅ Get patients successful');
    logger.info(`📊 Total patients: ${result.data.count}`);
    return true;
  } else {
    logger.error('❌ Get patients failed:', result.error);
    return false;
  }
};

const testCreateDoctor = async () => {
  logger.info('🔍 Testing Create Doctor...');
  const result = await apiCall('POST', '/users', testData.doctor, authToken);
  
  if (result.success) {
    testData.doctorId = result.data._id;
    logger.info('✅ Doctor created successfully');
    logger.info(`👨‍⚕️ Doctor ID: ${result.data._id}`);
    return true;
  } else {
    logger.error('❌ Create doctor failed:', result.error);
    return false;
  }
};

const testGetDoctors = async () => {
  logger.info('🔍 Testing Get Doctors...');
  const result = await apiCall('GET', '/doctors', null, authToken);
  
  if (result.success) {
    logger.info('✅ Get doctors successful');
    logger.info(`📊 Total doctors: ${result.data.count}`);
    return true;
  } else {
    logger.error('❌ Get doctors failed:', result.error);
    return false;
  }
};

const testCreateAppointment = async () => {
  logger.info('🔍 Testing Create Appointment...');
  const appointmentData = {
    ...testData.appointment,
    patientId: testData.patientId,
    doctorId: testData.doctorId
  };
  
  const result = await apiCall('POST', '/appointments', appointmentData, authToken);
  
  if (result.success) {
    testData.appointmentId = result.data._id;
    logger.info('✅ Appointment created successfully');
    logger.info(`📅 Appointment ID: ${result.data.appointmentId}`);
    return true;
  } else {
    logger.error('❌ Create appointment failed:', result.error);
    return false;
  }
};

const testGetAppointments = async () => {
  logger.info('🔍 Testing Get Appointments...');
  const result = await apiCall('GET', '/appointments', null, authToken);
  
  if (result.success) {
    logger.info('✅ Get appointments successful');
    logger.info(`📊 Total appointments: ${result.data.count}`);
    return true;
  } else {
    logger.error('❌ Get appointments failed:', result.error);
    return false;
  }
};

const testCreateVisit = async () => {
  logger.info('🔍 Testing Create Visit...');
  const visitData = {
    ...testData.visit,
    patientId: testData.patientId,
    doctorId: testData.doctorId
  };
  
  const result = await apiCall('POST', '/visits', visitData, authToken);
  
  if (result.success) {
    testData.visitId = result.data._id;
    logger.info('✅ Visit created successfully');
    logger.info(`🏥 Visit ID: ${result.data.visitId}`);
    return true;
  } else {
    logger.error('❌ Create visit failed:', result.error);
    return false;
  }
};

const testGetVisits = async () => {
  logger.info('🔍 Testing Get Visits...');
  const result = await apiCall('GET', '/visits', null, authToken);
  
  if (result.success) {
    logger.info('✅ Get visits successful');
    logger.info(`📊 Total visits: ${result.data.count}`);
    return true;
  } else {
    logger.error('❌ Get visits failed:', result.error);
    return false;
  }
};

const testDashboard = async () => {
  logger.info('🔍 Testing Dashboard...');
  const result = await apiCall('GET', '/dashboard/overview', null, authToken);
  
  if (result.success) {
    logger.info('✅ Dashboard data retrieved successfully');
    logger.info(`📊 Dashboard stats:`, result.data);
    return true;
  } else {
    logger.error('❌ Dashboard failed:', result.error);
    return false;
  }
};

const testUserManagement = async () => {
  logger.info('🔍 Testing User Management...');
  const result = await apiCall('GET', '/users', null, authToken);
  
  if (result.success) {
    logger.info('✅ User management successful');
    logger.info(`📊 Total users: ${result.data.count}`);
    return true;
  } else {
    logger.error('❌ User management failed:', result.error);
    return false;
  }
};

// Main test runner
const runTests = async () => {
  logger.info('🚀 Starting API Tests...\n');
  
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Admin Login', fn: testAdminLogin },
    { name: 'Create Patient', fn: testCreatePatient },
    { name: 'Get Patients', fn: testGetPatients },
    { name: 'Create Doctor', fn: testCreateDoctor },
    { name: 'Get Doctors', fn: testGetDoctors },
    { name: 'Create Appointment', fn: testCreateAppointment },
    { name: 'Get Appointments', fn: testGetAppointments },
    { name: 'Create Visit', fn: testCreateVisit },
    { name: 'Get Visits', fn: testGetVisits },
    { name: 'Dashboard', fn: testDashboard },
    { name: 'User Management', fn: testUserManagement }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      logger.error(`❌ Test ${test.name} threw an error:`, error.message);
      failed++;
    }
    logger.info(''); // Empty line for readability
  }

  logger.info('📊 Test Results Summary:');
  logger.info(`✅ Passed: ${passed}`);
  logger.info(`❌ Failed: ${failed}`);
  logger.info(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    logger.info('🎉 All tests passed! The system is working correctly with real data.');
  } else {
    logger.error('⚠️ Some tests failed. Please check the errors above.');
  }
};

// Run the tests
runTests().catch(error => {
  logger.error('💥 Test runner failed:', error);
  process.exit(1);
});

