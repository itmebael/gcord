/* SpreadsheetML keeps references and phone numbers as text, including leading zeroes. */
(function (global) {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  global.GcordSpreadsheet = function (rows) {
    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Worksheet ss:Name="Transactions"><Table>' + rows.map(function (row) {
        return '<Row>' + row.map(function (value) {
          var type = typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String';
          return '<Cell><Data ss:Type="' + type + '">' + escape(value) + '</Data></Cell>';
        }).join('') + '</Row>';
      }).join('') + '</Table></Worksheet></Workbook>';
  };
})(window);
