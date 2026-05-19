const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs-extra');
const path = require('path');

/**
 * Export data to CSV format
 */
function exportToCSV(data, headers, filename) {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  const csvHeaders = headers || Object.keys(data[0]);
  const csvRows = [
    csvHeaders.join(','),
    ...data.map(row => {
      return csvHeaders.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        // Escape quotes and wrap in quotes if contains comma or newline
        const stringValue = String(value).replace(/"/g, '""');
        if (stringValue.includes(',') || stringValue.includes('\n')) {
          return `"${stringValue}"`;
        }
        return stringValue;
      }).join(',');
    }),
  ];

  return csvRows.join('\n');
}

/**
 * Export data to Excel format
 */
async function exportToExcel(data, headers, filename, options = {}) {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(options.sheetName || 'Sheet1');

  // Set headers
  const headerRow = headers || Object.keys(data[0]);
  worksheet.addRow(headerRow);

  // Style header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Add data rows
  data.forEach(row => {
    const rowData = headerRow.map(header => {
      const value = row[header];
      return value !== null && value !== undefined ? value : '';
    });
    worksheet.addRow(rowData);
  });

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell({ includeEmpty: true }, cell => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Export data to PDF format
 */
function exportToPDF(data, headers, filename, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const buffer = Buffer.concat(buffers);
        resolve(buffer);
      });
      doc.on('error', reject);

      // Title
      doc.fontSize(20).text(options.title || 'Export Report', { align: 'center' });
      doc.moveDown();

      // Date
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      if (!data || data.length === 0) {
        doc.fontSize(12).text('No data to display', { align: 'center' });
        doc.end();
        return;
      }

      // Table headers
      const headerRow = headers || Object.keys(data[0]);
      const columnWidth = 500 / headerRow.length;
      let y = doc.y;

      // Draw header
      doc.fontSize(10).font('Helvetica-Bold');
      headerRow.forEach((header, i) => {
        doc.text(String(header), 50 + i * columnWidth, y, { width: columnWidth - 10 });
      });

      y += 20;
      doc.moveTo(50, y).lineTo(550, y).stroke();
      y += 10;

      // Draw data rows
      doc.fontSize(9).font('Helvetica');
      data.slice(0, options.maxRows || 100).forEach((row, rowIndex) => {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }

        headerRow.forEach((header, colIndex) => {
          const value = row[header];
          doc.text(String(value !== null && value !== undefined ? value : ''), 
            50 + colIndex * columnWidth, y, { width: columnWidth - 10 });
        });

        y += 15;
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Save export file to disk
 */
async function saveExportFile(buffer, filename, format = 'csv') {
  const exportDir = path.join(process.cwd(), 'exports');
  await fs.ensureDir(exportDir);

  const filepath = path.join(exportDir, `${filename}.${format}`);
  await fs.writeFile(filepath, buffer);

  return filepath;
}

module.exports = {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  saveExportFile,
};

