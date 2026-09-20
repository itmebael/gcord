/* Native XLSX workbook with text cells preserving reference and phone numbers. */
(function (global) {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Store-only ZIP packaging avoids a network dependency for report downloads.
  function zip(files) {
    var encoder = new TextEncoder(), locals = [], directory = [], offset = 0;
    function header(size) { return new DataView(new ArrayBuffer(size)); }
    function crc32(bytes) {
      var crc = 0xffffffff;
      bytes.forEach(function (byte) {
        crc ^= byte;
        for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      });
      return (crc ^ 0xffffffff) >>> 0;
    }
    Object.keys(files).forEach(function (path) {
      var name = encoder.encode(path), data = encoder.encode(files[path]), crc = crc32(data);
      var local = header(30);
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
      local.setUint16(12, 33, true); // 1980-01-01, valid DOS date
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
      locals.push(new Uint8Array(local.buffer), name, data);
      var central = header(46);
      central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true);
      central.setUint16(6, 20, true); central.setUint16(14, 33, true);
      central.setUint32(16, crc, true); central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true); central.setUint16(28, name.length, true);
      central.setUint32(42, offset, true);
      directory.push(new Uint8Array(central.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var directorySize = directory.reduce(function (sum, bytes) { return sum + bytes.length; }, 0);
    var end = header(22), count = Object.keys(files).length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, directorySize, true); end.setUint32(16, offset, true);
    var result = new Uint8Array(offset + directorySize + 22), position = 0;
    locals.concat(directory, [new Uint8Array(end.buffer)]).forEach(function (bytes) { result.set(bytes, position); position += bytes.length; });
    return result;
  }
  function column(index) {
    var name = '';
    for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
    return name;
  }
  global.GcordSpreadsheet = function (rows) {
    var ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    var rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
    var sheet = '<worksheet xmlns="' + ns + '"><sheetData>' + rows.map(function (row, index) {
      return '<row r="' + (index + 1) + '">' + row.map(function (value, col) {
        var ref = column(col) + (index + 1);
        if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + ref + '"><v>' + value + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escape(value) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('') + '</sheetData></worksheet>';
    return zip({
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels': '<Relationships xmlns="' + packageRel + '"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<workbook xmlns="' + ns + '" xmlns:r="' + rel + '"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + packageRel + '"><Relationship Id="rId1" Type="' + rel + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': sheet
    });
  };
})(window);
