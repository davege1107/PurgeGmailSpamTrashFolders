// ===============================
// GLOBAL CONFIG
// ===============================

var domainCache = {}; // in-memory cache

var TTL_GOOD = 86400; // 24h
var TTL_BAD  = 3600;  // 1h

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

// ===============================
// STATS
// ===============================

var stats = {
  processed: 0,
  deleted: 0,
  invalid_domain: 0,
  bad_tld: 0,
  blocked_domain: 0,
  bad_local: 0,
  dns_failed: 0,
  cache_hit: 0
};


// ===============================
// MAIN
// ===============================

function runPurge() {
  purgeDeletedFolder();
  Utilities.sleep(5000);
  purgeSpamFolder();
  logRunStats()
  sendDailyReport();
}


// ===============================
// PURGE TRASH
// ===============================

function purgeDeletedFolder() {
  console.log("purgeDeletedFolder() started");

  var threads = GmailApp.search('in:trash older_than:3d');

  threads.forEach(function(thread) {
    Gmail.Users.Threads.remove('me', thread.getId());
  });

  console.log("purgeDeletedFolder() ended");
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
        console.log("invalid email");
        break;
      }

      var parts = email.split("@");
      if (parts.length < 2) {
        stats.deleted++;
        stats.invalid_domain++;
        thread.moveToTrash();
        console.log("invalid email format");
        break;
      }

      var local = parts[0].toLowerCase();
      var domain = normalizeDomain(parts[1]);

      // ===============================
      // FILTER LOGIC
      // ===============================

      if (!domain) {
        stats.deleted++;
        stats.invalid_domain++;
        thread.moveToTrash();
        console.log("invalid domain");
        break;
      }

      if (!isAllowedTopLevelDomain(domain)) {
        stats.deleted++;
        stats.bad_tld++;
        thread.moveToTrash();
        console.log("not allowed domain", domain);
        break;
      }

      if (isBlockedDomain(domain)) {
        stats.deleted++;
        stats.blocked_domain++;
        thread.moveToTrash();
        console.log("blocked domain", domain);
        break;
      }

      if (KNOWN_GOOD_DOMAINS[domain]) {
        var score = scoreLocalPart(local);
        if (score <= -3) {
          stats.deleted++;
          stats.bad_local++;
          thread.moveToTrash();
          console.log("suspicious local part", local);
          break;
        }
      }

      if (!domainExists(domain)) {
        stats.deleted++;
        stats.dns_failed++;
        thread.moveToTrash();
        console.log("domain does not exist", domain);
        break;
      }

    }

  });

  console.log("purgeSpamFolder() ended");
}


// ===============================
// HELPERS
// ===============================

function extractEmail(fromHeader) {
  if (!fromHeader) return null;

  var match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader;
}


function normalizeDomain(domain) {
  if (!domain) return null;

  domain = domain.toLowerCase();

  if (domain.indexOf(" ") !== -1) return null;
  if (domain.endsWith(".")) return null;

  return domain;
}


function isAllowedTopLevelDomain(domain) {
  return (
    domain.endsWith(".com") ||
    domain.endsWith(".net") ||
    domain.endsWith(".org")
  );
}


function isBlockedDomain(domain) {
  return (
    domain.endsWith(".tk") ||
    domain.endsWith(".xxx")
  );
}


// ===============================
// LOCAL PART SCORING
// ===============================

function scoreLocalPart(local) {

  if (!local) return 0;

  var score = 0;

  if (local.length > 20) score -= 2;
  if (local.length >= 5 && local.length <= 15) score += 2;

  var digits = (local.match(/\d/g) || []).length;
  if (digits > local.length / 2) score -= 2;

  if (/\d{4,}/.test(local)) score -= 2;
  if (/(.)\1{3,}/.test(local)) score -= 2;

  var vowels = (local.match(/[aeiou]/g) || []).length;
  if (vowels === 0) score -= 2;

  if (/^[a-z]+\d*$/.test(local)) score += 1;

  return score;
}


// ===============================
// DOMAIN EXISTS (CACHE)
// ===============================

function domainExists(domain) {

  if (!domain) return false;

  if (KNOWN_GOOD_DOMAINS[domain]) {
    return true;
  }

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

    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());

      if (data.Answer && data.Answer.length > 0) {
        exists = true;
      }
    }

  } catch (e) {
    exists = false;
  }

  domainCache[domain] = exists;

  var ttl = exists ? TTL_GOOD : TTL_BAD;
  cache.put(domain, exists.toString(), ttl);

  return exists;
}


// ===============================
// DAILY REPORT
// ===============================

function sendDailyReport() {

  var props = PropertiesService.getScriptProperties();
  var lastSent = props.getProperty("last_report_date");

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  if (lastSent === today) {
    return;
  }

  var body =
    "Gmail Spam Cleanup Report\n\n" +
    "Processed: " + stats.processed + "\n" +
    "Deleted: " + stats.deleted + "\n\n" +

    "Reasons:\n" +
    "- Invalid domain: " + stats.invalid_domain + "\n" +
    "- Bad TLD: " + stats.bad_tld + "\n" +
    "- Blocked domain: " + stats.blocked_domain + "\n" +
    "- Suspicious local part: " + stats.bad_local + "\n" +
    "- DNS failed: " + stats.dns_failed + "\n\n" +

    "Cache hits: " + stats.cache_hit + "\n";

  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    "Daily Spam Cleanup Report",
    body
  );

  props.setProperty("last_report_date", today);
}

function logRunStats() {

  console.log("===== RUN STATISTICS =====");

  console.log("Processed:", stats.processed);
  console.log("Deleted:", stats.deleted);

  console.log("---- Reasons ----");
  console.log("Invalid domain:", stats.invalid_domain);
  console.log("Bad TLD:", stats.bad_tld);
  console.log("Blocked domain:", stats.blocked_domain);
  console.log("Suspicious local part:", stats.bad_local);
  console.log("DNS failed:", stats.dns_failed);

  console.log("Cache hits:", stats.cache_hit);

  var deleteRate = stats.processed > 0
    ? ((stats.deleted / stats.processed) * 100).toFixed(2)
    : 0;

  console.log("Delete rate:", deleteRate + "%");

  console.log("==========================");
}
