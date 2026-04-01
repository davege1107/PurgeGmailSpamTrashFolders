// ===============================
// GLOBAL CONFIG
// ===============================

var domainCache = {};

var TTL_GOOD = 86400;
var TTL_BAD  = 3600;

var KNOWN_GOOD_DOMAINS = {
  "gmail.com": true,
  "googlemail.com": true,
  "outlook.com": true,
  "hotmail.com": true,
  "live.com": true,
  "mail.com": true,
  "fastmail.com": true,
  "yahoo.com": true,
  "icloud.com": true,
  "aol.com": true
};

var ENABLE_TLDS_VALIDATION = true;

var ALLOWED_TLDS = [
  ".com",
  ".net",
  ".org"
];

var INFRA_DOMAINS = [
  "sendgrid.net",
  "amazonses.com",
  "mailgun.org",
  "sparkpostmail.com"
];

var BLOCKED_DOMAINS = [
  ".tk",
  "onlinecrm.marketing"
];

var ENABLE_FORWARDING_EMAIL = true;
var FORWARDING_EMAIL = "xxxxxxxxxxxxxxx@yopmail.com";
// ===============================
// STATS
// ===============================

var stats = {
  processed: 0,
  deleted: 0,

  permanently_deleted: 0,
  permanently_deleted_list: [],

  invalid_domain: 0,
  bad_tld: 0,
  blocked_domain: 0,
  dns_failed: 0,
  cache_hit: 0,

  spf_misaligned: 0,
  infra_abuse: 0
};

// ===============================
// MAIN
// ===============================

function runPurge() {
  purgeSpamFolder();
  logRunStats();
  sendToTelegram();
}

// ===============================
// PURGE SPAM
// ===============================

function purgeSpamFolder() {

  console.log("purgeSpamFolder() started");

  var threads = GmailApp.search('in:spam newer_than:1d');

  threads.forEach(function(thread) {

    var messages = thread.getMessages();

    for (var i = 0; i < messages.length; i++) {

      stats.processed++;

      var fromHeader = messages[i].getFrom();
      var email = extractEmail(fromHeader);

      if (!email) {
        stats.deleted++;
        stats.invalid_domain++;
        thread.moveToTrash();
        break;
      }

      var parts = email.split("@");
      if (parts.length < 2) {
        stats.deleted++;
        stats.invalid_domain++;
        thread.moveToTrash();
        break;
      }

      var domain = normalizeDomain(parts[1]);

      if (!domain) {
        stats.deleted++;
        stats.invalid_domain++;
        thread.moveToTrash();
        break;
      }

      // ===============================
      // HARD DELETE (no MX + no A)
      // ===============================

      var hasMx = domainExists(domain);
      var hasA  = hasARecord(domain);

      if (!KNOWN_GOOD_DOMAINS[domain] && !hasMx && !hasA) {
        if(permanentlyDeleteAndForward(thread, messages[i], email, domain)) {
          break;
        }
      }

      // ===============================
      // BASIC FILTERS
      // ===============================

      if (!isAllowedTopLevelDomain(domain)) {
        stats.deleted++;
        stats.bad_tld++;
        thread.moveToTrash();
        break;
      }

      if (isBlockedDomain(domain)) {
        stats.deleted++;
        stats.blocked_domain++;
        thread.moveToTrash();
        break;
      }

      if (!domainExists(domain)) {
        stats.deleted++;
        stats.dns_failed++;
        thread.moveToTrash();
        break;
      }

      // ===============================
      // HEADER ANALYSIS
      // ===============================

      var headers = messages[i].getRawContent();

      var returnPathEmail = extractReturnPath(headers);
      var returnPathDomain = getDomainFromEmail(returnPathEmail);

      var baseFrom = getBaseDomain(domain);
      var baseReturn = getBaseDomain(returnPathDomain);

      // SPF ALIGNMENT
      var spfMisaligned = false;

      if (returnPathDomain && baseFrom && baseReturn) {
        if (baseFrom !== baseReturn) {
          spfMisaligned = true;
          stats.spf_misaligned++;
          console.log("SPF MISALIGNED:", domain, "vs", returnPathDomain);
        }
      }

      // INFRA ABUSE
      var infraAbuse = false;

      if (returnPathDomain && isInfraDomain(returnPathDomain)) {
        if (baseFrom !== baseReturn) {
          infraAbuse = true;
          stats.infra_abuse++;
          console.log("INFRA ABUSE:", returnPathDomain, "->", domain);
        }
      }

      // SOFT DELETE
      if (spfMisaligned || infraAbuse) {
        stats.deleted++;
        thread.moveToTrash();
        console.log("SOFT DELETE:", email);
        break;
      }

    }

  });

  console.log("purgeSpamFolder() ended");
}

function permanentlyDeleteAndForward(thread, message, email, domain) {

  // ===============================
  // STATS
  // ===============================

  stats.deleted++;
  stats.permanently_deleted++;
  stats.permanently_deleted_list.push(email);

  console.log("PERMANENT DELETE:", email);

  // ===============================
  // FORWARD
  // ===============================

  if (!ENABLE_FORWARDING_EMAIL) {
  
    Gmail.Users.Threads.remove('me', thread.getId());
    return true;
  }

  try {
    message.forward(FORWARDING_EMAIL);
  } catch (e) {
    console.log("Forward failed:", e);
  }

  // ===============================
  // WAIT FOR STABILITY
  // ===============================

  var stable = false;

  for (var attempt = 0; attempt < 6; attempt++) {
    Utilities.sleep(1000);

    try {
      GmailApp.getThreadById(thread.getId());
      stable = true;
      break;
    } catch (e) {
      console.log("still not ready...");
    }
  }

  if (!stable) {
    console.log("Thread not stable, proceeding anyway");
  }

  Utilities.sleep(1000);
  // ===============================
  // DELETE WITH RETRY
  // ===============================

  for (var retry = 0; retry < 3; retry++) {
    try {
      Gmail.Users.Threads.remove('me', thread.getId());
      console.log("Message successfully deleted");
      return true;
    } catch (e) {
      console.log("Delete failed, retry:", retry, e);
      Utilities.sleep(1000);
    }
  }

  return true;
}

// ===============================
// HELPERS
// ===============================

function extractEmail(fromHeader) {
  if (!fromHeader) return null;
  var match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader;
}

function extractReturnPath(headers) {
  if (!headers) return null;
  var match = headers.match(/Return-Path:\s*<([^>]+)>/i);
  return match ? match[1] : null;
}

function getDomainFromEmail(email) {
  if (!email) return null;
  var parts = email.split("@");
  return parts.length > 1 ? normalizeDomain(parts[1]) : null;
}

function normalizeDomain(domain) {
  if (!domain) return null;

  domain = domain.toLowerCase();

  if (domain.indexOf(" ") !== -1) return null;
  if (domain.endsWith(".")) return null;

  return domain;
}

function getBaseDomain(domain) {
  if (!domain) return null;

  var parts = domain.split(".");
  if (parts.length <= 2) return domain;

  var special = ["co.il", "co.uk", "com.au"];
  var last2 = parts.slice(-2).join(".");
  var last3 = parts.slice(-3).join(".");

  if (special.includes(last2)) return last3;

  return last2;
}

function isAllowedTopLevelDomain(domain) {
  if (!domain) return false;

  if (!ENABLE_TLDS_VALIDATION) return true;

  for (var i = 0; i < ALLOWED_TLDS.length; i++) {
    if (domain.endsWith(ALLOWED_TLDS[i])) {
      return true;
    }
  }
  return false;
}

function isBlockedDomain(domain) {

  if (!domain) return false;

  if (!BLOCKED_DOMAINS || BLOCKED_DOMAINS.length === 0) {
    return false;
  }

  for (var i = 0; i < BLOCKED_DOMAINS.length; i++) {
    if (domain.endsWith(BLOCKED_DOMAINS[i])) {
      return true;
    }
  }

  return false;
}

function isInfraDomain(domain) {
  if (!domain) return false;
  return INFRA_DOMAINS.some(function(d) {
    return domain.endsWith(d);
  });
}

// ===============================
// DNS
// ===============================

function domainExists(domain) {

  if (!domain) return false;

  if (KNOWN_GOOD_DOMAINS[domain]) return true;

  if (domainCache.hasOwnProperty(domain)) {
    return domainCache[domain];
  }

  var cache = CacheService.getScriptCache();

  var cached = cache.get(domain);
  if (cached !== null) {
    stats.cache_hit++;
    var result = (cached === "true");
    domainCache[domain] = result;
    return result;
  }

  var exists = false;

  try {
    var url = "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=MX";

    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      if (data.Answer && data.Answer.length > 0) {
        exists = true;
      }
    }

  } catch (e) {}

  domainCache[domain] = exists;

  var ttl = exists ? TTL_GOOD : TTL_BAD;
  cache.put(domain, exists.toString(), ttl);

  return exists;
}

function hasARecord(domain) {
  try {
    var url = "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=A";

    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      return data.Answer && data.Answer.length > 0;
    }

  } catch (e) {}

  return false;
}

// ===============================
// LOGGING
// ===============================

function logRunStats() {

  console.log("===== RUN STATISTICS =====");

  console.log("Processed:", stats.processed);
  console.log("Deleted:", stats.deleted);
  console.log("Permanently deleted:", stats.permanently_deleted);

  console.log("SPF misaligned:", stats.spf_misaligned);
  console.log("Infra abuse:", stats.infra_abuse);

  console.log("Cache hits:", stats.cache_hit);

  console.log("==========================");
}

// ===============================
// TELEGRAM
// ===============================

function sendToTelegram() {

  var BOT_TOKEN = "xxxx:yyyy-zzzzzzzzzzzzzzz";
  var CHAT_ID = "-100wwwwwwwwwwwwwwwwwwwww";

  var deleteRate = stats.processed > 0
    ? ((stats.deleted / stats.processed) * 100).toFixed(2)
    : 0;

  var text =
    "Spam Cleanup Report\n\n" +
    "Processed: " + stats.processed + "\n" +
    "Deleted: " + stats.deleted + " (" + deleteRate + "%)\n" +
    "Permanently deleted: " + stats.permanently_deleted + "\n\n" +

    "SPF misaligned: " + stats.spf_misaligned + "\n" +
    "Infra abuse: " + stats.infra_abuse + "\n\n" +

    "Cache hits: " + stats.cache_hit;

  if (stats.permanently_deleted_list.length > 0) {
    text += "\n\n Permanently deleted:\n";

    stats.permanently_deleted_list.slice(0, 20).forEach(function(e) {
      text += "• " + e + "\n";
    });

    if (stats.permanently_deleted_list.length > 20) {
      text += "...and more (" + stats.permanently_deleted_list.length + ")";
    }
  }

  var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";

  UrlFetchApp.fetch(url, {
    method: "post",
    payload: {
      chat_id: CHAT_ID,
      text: text
    }
  });
}
