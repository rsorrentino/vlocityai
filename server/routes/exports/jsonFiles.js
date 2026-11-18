/** Export API (/api/exports): checking and repairing exported DataPack JSON files. Mounted by ../exports.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, NotFoundError, ValidationError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const dataPackFileFixer = require('../../services/dataPackFileFixer');

/**
 * @swagger
 * /api/exports/fix-json-files:
 *   post:
 *     operationId: fixExportJsonFiles
 *     summary: Fix malformed JSON files in export directory
 *     description: Scans the specified export directory (or a sub-directory) for malformed JSON files and attempts to repair them in-place.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               exportPath:
 *                 type: string
 *                 default: ./export
 *                 description: Path to the root export directory.
 *               dataPackType:
 *                 type: string
 *                 nullable: true
 *                 description: Limit fix to this DataPack type sub-directory (e.g. `SObject_PricingElement`).
 *               dataPackName:
 *                 type: string
 *                 nullable: true
 *                 description: Limit fix to this specific DataPack name (requires `dataPackType`).
 *     responses:
 *       200:
 *         description: Fix operation completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 exportPath:
 *                   type: string
 *                 results:
 *                   type: object
 *                   properties:
 *                     totalFixed:
 *                       type: integer
 *                     totalFailed:
 *                       type: integer
 *                     totalSkipped:
 *                       type: integer
 *       400:
 *         description: exportPath is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export directory not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/fix-json-files', asyncHandler(async (req, res) => {
  const { exportPath = './export', dataPackType = null, dataPackName = null } = req.body;

  if (!exportPath) {
    throw new ValidationError('exportPath is required');
  }

  // Resolve absolute path
  const fullExportPath = path.isAbsolute(exportPath) 
    ? exportPath 
    : path.join(process.cwd(), exportPath);

  // Check if path exists
  if (!await fs.pathExists(fullExportPath)) {
    throw new NotFoundError(`Export directory not found: ${fullExportPath}`);
  }

  logger.logOperation('Fixing JSON files in export directory', {
    exportPath: fullExportPath,
    dataPackType,
    dataPackName
  });

  let results;

  try {
    if (dataPackName && dataPackType) {
      // Fix specific DataPack
      const dataPackPath = path.join(fullExportPath, dataPackType, dataPackName);
      if (!await fs.pathExists(dataPackPath)) {
        throw new NotFoundError(`DataPack directory not found: ${dataPackPath}`);
      }
      results = await dataPackFileFixer.fixDataPackDirectory(dataPackPath);
    } else if (dataPackType) {
      // Fix all DataPacks of a specific type
      const typePath = path.join(fullExportPath, dataPackType);
      if (!await fs.pathExists(typePath)) {
        throw new NotFoundError(`DataPack type directory not found: ${typePath}`);
      }
      results = await dataPackFileFixer.fixDataPackDirectory(typePath);
    } else {
      // Fix entire export directory
      results = await dataPackFileFixer.fixExportDirectory(fullExportPath);
    }

    logger.logOperation('JSON file fix completed', {
      exportPath: fullExportPath,
      results
    });

    res.json({
      success: true,
      message: `Fixed ${results.totalFixed || 0} JSON file(s), ${results.totalFailed || 0} failed, ${results.totalSkipped || 0} already valid`,
      exportPath: fullExportPath,
      results
    });
  } catch (error) {
    logger.logError(error, { 
      operation: 'fixJsonFiles', 
      exportPath: fullExportPath,
      dataPackType,
      dataPackName
    });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/validate-json-files:
 *   get:
 *     operationId: validateExportJsonFiles
 *     summary: Validate JSON files in export directory
 *     description: Scans the specified export directory for malformed JSON files and reports results without modifying any files.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: exportPath
 *         schema:
 *           type: string
 *           default: ./export
 *         description: Path to the root export directory.
 *       - in: query
 *         name: dataPackType
 *         schema:
 *           type: string
 *         description: Limit validation to this DataPack type sub-directory.
 *       - in: query
 *         name: dataPackName
 *         schema:
 *           type: string
 *         description: Limit validation to this specific DataPack name (requires `dataPackType`).
 *     responses:
 *       200:
 *         description: Validation completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalFiles:
 *                   type: integer
 *                 validFiles:
 *                   type: integer
 *                 invalidFiles:
 *                   type: integer
 *                 invalidFileList:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export directory not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/validate-json-files', asyncHandler(async (req, res) => {
  const { exportPath = './export', dataPackType = null, dataPackName = null } = req.query;

  // Resolve absolute path
  const fullExportPath = path.isAbsolute(exportPath) 
    ? exportPath 
    : path.join(process.cwd(), exportPath);

  // Check if path exists
  if (!await fs.pathExists(fullExportPath)) {
    throw new NotFoundError(`Export directory not found: ${fullExportPath}`);
  }

  logger.logOperation('Validating JSON files in export directory', {
    exportPath: fullExportPath,
    dataPackType,
    dataPackName
  });

  try {
    let targetPath = fullExportPath;
    
    if (dataPackName && dataPackType) {
      targetPath = path.join(fullExportPath, dataPackType, dataPackName);
    } else if (dataPackType) {
      targetPath = path.join(fullExportPath, dataPackType);
    }

    if (!await fs.pathExists(targetPath)) {
      throw new NotFoundError(`Directory not found: ${targetPath}`);
    }

    // Find all JSON files
    const jsonFiles = await dataPackFileFixer.findJsonFiles(targetPath);
    const invalidFiles = [];
    const validFiles = [];

    // Validate each file
    for (const filePath of jsonFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        JSON.parse(content.trim());
        validFiles.push(filePath);
      } catch (parseError) {
        invalidFiles.push({
          path: filePath,
          error: parseError.message,
          relativePath: path.relative(fullExportPath, filePath)
        });
      }
    }

    const results = {
      totalFiles: jsonFiles.length,
      validFiles: validFiles.length,
      invalidFiles: invalidFiles.length,
      invalidFileList: invalidFiles
    };

    logger.logOperation('JSON file validation completed', {
      exportPath: fullExportPath,
      results
    });

    res.json({
      success: true,
      message: `Found ${invalidFiles.length} invalid JSON file(s) out of ${jsonFiles.length} total`,
      exportPath: fullExportPath,
      results
    });
  } catch (error) {
    logger.logError(error, { 
      operation: 'validateJsonFiles', 
      exportPath: fullExportPath,
      dataPackType,
      dataPackName
    });
    throw error;
  }
}));

module.exports = router;
