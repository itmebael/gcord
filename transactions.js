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
    if (/^9\d{9}$/.test(n)) n = '0' + n;
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

    var lines = text.split(/\n+/);
    var referenceLines = {};
    lines.some(function (line, index) {
      var label = /\bref(?:erence)?\.?\s*(?:(?:number|no\.?)\s*|#\s*)?[:.\-]?\s*/i.exec(line);
      if (!label) return false;
      referenceLines[index] = true;
      var value = line.slice(label.index + label[0].length);
      var digits = value.match(/^(\d[\d \t-]*)/);
      var ref = digits ? normalizeRef(digits[1]) : '';
      // Receipts can wrap the identifier below its label or across numeric lines.
      for (var next = index + 1; ref.length < 13 && next < lines.length; next++) {
        if (!/^\s*\d[\d \t-]*\s*$/.test(lines[next])) break;
        if (/^09\d{9}$/.test(normalizeNumber(lines[next]))) break;
        referenceLines[next] = true;
        ref += normalizeRef(lines[next]);
      }
      if (ref.length >= 10) result.ref = ref;
      return !!result.ref;
    });
    if (!result.ref) {
      lines.some(function (line) {
        var candidate = line.trim();
        if (!/^\d[\d \t-]*$/.test(candidate)) return false;
        var digits = normalizeRef(candidate);
        if (digits.length < 13) return false;
        result.ref = digits;
        return true;
      });
    }

    var amountMatch =
      text.match(/(?:amount|total|you sent|sent)\s*[:.\-]?\s*(?:php|₱|p)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i) ||
      text.match(/(?:₱|php)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i) ||
      flat.match(/\b([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\b/);
    if (amountMatch) result.amount = amountMatch[1].replace(/,/g, '');

    var phoneLines = lines.filter(function (_, index) { return !referenceLines[index]; });
    // Prefer a recipient-labelled line when a receipt also contains a sender number.
    phoneLines.sort(function (a, b) {
      var label = /\b(?:recipient|mobile|phone|account|to)\b/i;
      return Number(label.test(b)) - Number(label.test(a));
    });
    phoneLines.some(function (line) {
      var candidates = line.match(/\+?\d(?:[\d \t()-]*\d)?/g) || [];
      return candidates.some(function (candidate) {
        var number = normalizeNumber(candidate);
        if (!/^09\d{9}$/.test(number)) return false;
        result.number = number;
        return true;
      });
    });
    // Keep masked phone text for display only; never invent the hidden digits.
    if (!result.number) {
      phoneLines.some(function (line) {
        var masked = line.match(/(?:\+?63|09)[\d*\u2022xX \t()-]{7,20}/);
        if (masked && /[*\u2022xX]/.test(masked[0])) {
          result.maskedNumber = masked[0].trim(); return true;
        }
        return false;
      });
    }

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

    function acceptName(value) {
      var name = value.trim().replace(/[\u2217\u2022\u25cf\uff0a]/g, '*').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
      // OCR often merges the name and mobile number into one line.
      name = name.replace(/\s*\(?\+?(?:63\s*9|09|9\d{2})[\d *xX()-]{6,}\)?\s*$/, '').trim();
      if (!/^[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f *\u2022.'-]{1,79}$/.test(name)) return false;
      if (/\b(?:reference|amount|gcash|success(?:ful(?:ly)?)?|total|date|time|php|sent|received|payment|receipt|number|send|money|express|transfer|thank|you|from|balance|mobile|phone|account)\b/i.test(name)) return false;
      result.recipient = name.toUpperCase(); return true;
    }
    // Names can follow a label or appear on its next line, including masked names.
    lines.some(function (line, index) {
      var match = /^\s*(?:(?:you\s+(?:have\s+)?)?sent to|send to|paid to|recipient(?:['’]s)?(?: name)?|receiver(?:['’]s)?(?: name)?|name|to)\b\s*[:.-]?\s*(.*)$/i.exec(line);
      if (!match) return false;
      return acceptName(match[1]) || (!match[1].trim() && acceptName(lines[index + 1] || ''));
    });
    if (!result.recipient) {
      lines.some(function (line) {
        return /[*\u2022\u2217\u25cf\uff0a]/.test(line) && acceptName(line);
      });
    }
    // Common receipt layout: an unlabelled recipient name directly above their phone.
    if (!result.recipient) {
      lines.some(function (line, index) {
        if (!result.number || normalizeNumber(line) !== result.number || index === 0) return false;
        var candidate = lines[index - 1];
        if (/\b(?:from|sender)\b/i.test(candidate + ' ' + (lines[index - 2] || ''))) return false;
        return acceptName(candidate);
      });
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
