#!/usr/bin/env node

/**
 * Migration script to add context fields to existing jobs
 * This script adds the new context fields (username, filePath, projectPath, etc.) to the jobs table
 */

const { Sequelize } = require('sequelize');
const path = require('path');
const logger = require('../server/utils/logger');

// Database configuration
const databaseUrl = process.env.DATABASE_URL || 
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'vlocity_manager'}`;

const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';

async function migrateJobContext() {
  let sequelize;
  
  try {
    console.log('Starting job context migration...');
    
    // Initialize Sequelize connection
    if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
      sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        define: {
          timestamps: true,
          underscored: true,
          freezeTableName: true,
          schema: schema
        },
        schema: schema
      });
    } else {
      throw new Error('This migration is designed for PostgreSQL only');
    }

    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Check if the jobs table exists
    const [results] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${schema}' 
        AND table_name = 'jobs'
      );
    `);

    if (!results[0].exists) {
      console.log('❌ Jobs table does not exist. Please run the main setup first.');
      return;
    }

    console.log('✅ Jobs table exists');

    // Check if context fields already exist
    const [columnResults] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = '${schema}' 
      AND table_name = 'jobs' 
      AND column_name IN ('username', 'file_path', 'project_path', 'source_username', 'target_username', 'environment');
    `);

    const existingColumns = columnResults.map(row => row.column_name);
    console.log('Existing context columns:', existingColumns);

    // Add missing context fields
    const contextFields = [
      { name: 'username', type: 'VARCHAR(255)', comment: 'Salesforce username used for the job' },
      { name: 'file_path', type: 'VARCHAR(500)', comment: 'Path to the job configuration file' },
      { name: 'project_path', type: 'VARCHAR(500)', comment: 'Project path for export/deploy operations' },
      { name: 'source_username', type: 'VARCHAR(255)', comment: 'Source Salesforce username (for deploy jobs)' },
      { name: 'target_username', type: 'VARCHAR(255)', comment: 'Target Salesforce username (for deploy jobs)' },
      { name: 'environment', type: 'VARCHAR(50)', comment: 'Environment context (dev, uat, prod)' }
    ];

    for (const field of contextFields) {
      if (!existingColumns.includes(field.name)) {
        console.log(`Adding column: ${field.name}`);
        await sequelize.query(`
          ALTER TABLE "${schema}"."jobs" 
          ADD COLUMN "${field.name}" ${field.type};
        `);
        
        if (field.comment) {
          await sequelize.query(`
            COMMENT ON COLUMN "${schema}"."jobs"."${field.name}" IS '${field.comment}';
          `);
        }
        
        console.log(`✅ Added column: ${field.name}`);
      } else {
        console.log(`⏭️  Column ${field.name} already exists`);
      }
    }

    // Update existing jobs with context information where possible
    console.log('Updating existing jobs with context information...');
    
    // For jobs that have configuration data, try to extract context information
    const [jobs] = await sequelize.query(`
      SELECT id, name, type, configuration 
      FROM "${schema}"."jobs" 
      WHERE username IS NULL OR file_path IS NULL OR project_path IS NULL;
    `);

    console.log(`Found ${jobs.length} jobs to update`);

    for (const job of jobs) {
      const updates = {};
      
      try {
        // Extract context from configuration if available
        if (job.configuration) {
          const config = typeof job.configuration === 'string' 
            ? JSON.parse(job.configuration) 
            : job.configuration;

          // Extract username from configuration
          if (config.username && !job.username) {
            updates.username = config.username;
          }
          
          // Extract project path
          if (config.projectPath && !job.project_path) {
            updates.project_path = config.projectPath;
          }
          
          // Extract source/target usernames for deploy jobs
          if (job.type === 'deploy') {
            if (config.sourceUsername && !job.source_username) {
              updates.source_username = config.sourceUsername;
            }
            if (config.targetUsername && !job.target_username) {
              updates.target_username = config.targetUsername;
            }
          }
          
          // Set default environment if not set
          if (!job.environment) {
            updates.environment = 'dev';
          }
        }

        // Set default values for missing fields
        if (!job.username) {
          updates.username = 'system';
        }
        if (!job.project_path) {
          updates.project_path = job.type === 'export' ? './export' : './deploy';
        }
        if (!job.environment) {
          updates.environment = 'dev';
        }

        // Update the job if we have any updates
        if (Object.keys(updates).length > 0) {
          const updateQuery = `
            UPDATE "${schema}"."jobs" 
            SET ${Object.keys(updates).map(key => `"${key}" = :${key}`).join(', ')}
            WHERE id = :id
          `;
          
          await sequelize.query(updateQuery, {
            replacements: { ...updates, id: job.id }
          });
          
          console.log(`✅ Updated job: ${job.name}`);
        }
        
      } catch (error) {
        console.log(`⚠️  Error updating job ${job.name}:`, error.message);
      }
    }

    console.log('✅ Job context migration completed successfully');
    
    // Verify the migration
    const [verifyResults] = await sequelize.query(`
      SELECT COUNT(*) as total_jobs,
             COUNT(username) as jobs_with_username,
             COUNT(file_path) as jobs_with_file_path,
             COUNT(project_path) as jobs_with_project_path,
             COUNT(environment) as jobs_with_environment
      FROM "${schema}"."jobs";
    `);
    
    const stats = verifyResults[0];
    console.log('\n📊 Migration Statistics:');
    console.log(`Total jobs: ${stats.total_jobs}`);
    console.log(`Jobs with username: ${stats.jobs_with_username}`);
    console.log(`Jobs with file_path: ${stats.jobs_with_file_path}`);
    console.log(`Jobs with project_path: ${stats.jobs_with_project_path}`);
    console.log(`Jobs with environment: ${stats.jobs_with_environment}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    logger.logError(error, { operation: 'Job context migration' });
    process.exit(1);
  } finally {
    if (sequelize) {
      await sequelize.close();
      console.log('Database connection closed');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateJobContext()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateJobContext };
