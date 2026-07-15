/* GCash parse helpers + transaction bridge (uses Supabase via GcordAPI). */
(function (global) {
  function formatAmount(value) {
    var n = Number(value) || 0;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function normalizeRef(ref) {
    return String(ref || '').replace(/\D/g, '');
  }

  function normalizeNumber(num) {
    var n = String(num || '').replace(/\D/g, '');
    if (n.indexOf('63') === 0 && n.length >= 12) n = '0' + n.slice(2);
    return n;
  }

  function formatRefDisplay(ref) {
    var digits = normalizeRef(ref);
    if (digits.length < 7) return '#' + digits;
    return '#' + digits.slice(0, 5) + '<br>' + digits.slice(5, 10) + (digits.length > 10 ? '<br>' + digits.slice(10) : '');
  }

  function parseGCashText(rawText) {
    var text = String(rawText || '').replace(/\r/g, '\n');
    var flat = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    var result = { recipient: '', number: '', amount: '', ref: '', date: '', time: '' };

    var refMatch =
      text.match(/ref(?:erence)?(?:\s*(?:no\.?|number|#))?\s*[:.\-]?\s*([0-9][0-9\s\-]{10,20}[0-9])/i) ||
      flat.match(/\b(\d{13})\b/) ||
      flat.match(/\b(\d{4}\s?\d{4}\s?\d{4}\s?\d{1,4})\b/);
    if (refMatch) result.ref = normalizeRef(refMatch[1]);

    var amountMatch =
      text.match(/(?:amount|total|you sent|sent)\s*[:.\-]?\s*(?:php|₱|p)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i) ||
      text.match(/(?:₱|php)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i) ||
      flat.match(/\b([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\b/);
    if (amountMatch) result.amount = amountMatch[1].replace(/,/g, '');

    var numberMatch =
      text.match(/(?:mobile|number|account|to)\s*[:.\-]?\s*((?:\+?63|0)?9\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/i) ||
      flat.match(/((?:\+?63|0)?9\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/);
    if (numberMatch) result.number = normalizeNumber(numberMatch[1]);

    var dateMatch =
      text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/) ||
      text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i);
    if (dateMatch) {
      var parsedDate = new Date(dateMatch[1].replace(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, function (_, a, b, c) {
        var year = c.length === 2 ? '20' + c : c;
        return b + '/' + a + '/' + year;
      }));
      result.date = !isNaN(parsedDate.getTime()) ? formatDate(parsedDate) : dateMatch[1];
    }

    var timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
    if (timeMatch) {
      var t = timeMatch[1].toUpperCase();
      if (!/AM|PM/.test(t)) {
        var parts = t.split(':');
        var h = Number(parts[0]);
        var m = parts[1];
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        t = h + ':' + m + ' ' + ampm;
      }
      result.time = t;
    }

    var nameMatch =
      text.match(/(?:sent to|to|recipient|name)\s*[:.\-]?\s*([A-Za-z][A-Za-z .'-]{2,40})/i) ||
      text.match(/\b([A-Z][A-Z .'-]{4,40})\b/);
    if (nameMatch) {
      var name = nameMatch[1].replace(/\s+/g, ' ').trim();
      if (!/REFERENCE|AMOUNT|GCASH|SUCCESS|TOTAL|DATE|TIME|PHP/.test(name.toUpperCase())) {
        result.recipient = name.toUpperCase();
      }
    }

    return result;
  }

  async function getAll() {
    if (!global.GcordAPI) throw new Error('Supabase API not loaded');
    return global.GcordAPI.listTransactions();
  }

  async function addTransaction(payload) {
    if (!global.GcordAPI) throw new Error('Supabase API not loaded');
    return global.GcordAPI.addTransaction(payload);
  }

  async function findByRef(ref) {
    if (!global.GcordAPI) throw new Error('Supabase API not loaded');
    return global.GcordAPI.findTransactionByRef(ref);
  }

  async function getStats() {
    if (!global.GcordAPI) throw new Error('Supabase API not loaded');
    return global.GcordAPI.getTransactionStats();
  }

  global.GcordTransactions = {
    getAll: getAll,
    addTransaction: addTransaction,
    findByRef: findByRef,
    getStats: getStats,
    formatAmount: formatAmount,
    formatRefDisplay: formatRefDisplay,
    normalizeRef: normalizeRef,
    normalizeNumber: normalizeNumber,
    parseGCashText: parseGCashText,
    formatDate: formatDate,
    formatTime: formatTime
  };
})(window);
