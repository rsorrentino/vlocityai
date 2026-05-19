const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const databaseService = require('../server/services/databaseService');
const logger = require('../server/utils/logger');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/vlocity_manager.db';

// Default users to create
const defaultUsers = [
  {
    username: 'admin',
    email: 'admin@amplifon.com',
    password: 'Admin123!',
    firstName: 'System',
    lastName: 'Administrator',
    role: 'admin'
  },
  {
    username: 'developer',
    email: 'developer@amplifon.com',
    password: 'Dev123!',
    firstName: 'John',
    lastName: 'Developer',
    role: 'developer'
  },
  {
    username: 'functional',
    email: 'functional@amplifon.com',
    password: 'Func123!',
    firstName: 'Jane',
    lastName: 'Functional',
    role: 'functional'
  }
];

async function createDefaultUsers() {
  try {
    logger.info('👥 Creating default users for Vlocity DataPack Manager...');
    
    // Use the databaseService to ensure consistent configuration
    await databaseService.connect();
    logger.info('✅ Connected to database via databaseService');

    // Sync models using the databaseService
    await databaseService.syncModels();
    logger.info('✅ Database models synchronized');

    // Import models AFTER setting up the connection with schema
    const { User } = require('../server/models');

    // Check if users already exist
    const existingUsers = await User.findAll();
    if (existingUsers.length > 0) {
      logger.info('⚠️ Users already exist in database. Skipping creation.');
      logger.info('Existing users:', existingUsers.map(u => ({ username: u.username, role: u.role })));
      return;
    }

    // Create users
    logger.info('🚀 Creating default users...');
    
    for (const userData of defaultUsers) {
      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      // Create user
      const user = await User.create({
        ...userData,
        password: hashedPassword
      });
      
      logger.info(`✅ Created user: ${user.username} (${user.role})`);
    }

    logger.info('🎉 Default users created successfully!');
    logger.info('📋 Login Credentials:');
    logger.info('┌─────────────┬─────────────────────┬─────────────┬─────────────┐');
    logger.info('│ Username    │ Email               │ Password    │ Role        │');
    logger.info('├─────────────┼─────────────────────┼─────────────┼─────────────┤');
    
    defaultUsers.forEach(user => {
      logger.info(`│ ${user.username.padEnd(11)} │ ${user.email.padEnd(19)} │ ${user.password.padEnd(11)} │ ${user.role.padEnd(11)} │`);
    });
    
    logger.info('└─────────────┴─────────────────────┴─────────────┴─────────────┘');
    
    logger.info('⚠️ IMPORTANT: Change these default passwords after first login!');
    logger.info('🔗 Access the application at: http://localhost:3001');
    
  } catch (error) {
    logger.error(`❌ Error creating default users: ${error.message}`);
    throw error;
  } finally {
    // Close connection using databaseService
    await databaseService.disconnect();
    logger.info('🔌 Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  createDefaultUsers()
    .then(() => {
      logger.info('Create users script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`Create users script failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { createDefaultUsers };
