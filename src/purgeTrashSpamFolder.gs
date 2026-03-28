var domainCache = {}; // in-memory cache

var TTL_GOOD = 86400;  // 24h
var TTL_BAD  = 3600;   // 1h

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
// MAIN
// ===============================

function runPurge() {
  purgeDeletedFolder();
  Utilities.sleep(5000);
  purgeSpamFolder();
}


// ===============================
// PURGE TRASH
// ===============================

function purgeDeletedFolder() {
  console.log("purgeDeletedFolder() started");

  var threads = GmailApp.search('in:trash older_than:7d');

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

      var domain = extractDomain(messages[i].getFrom());

      //  invalid domain → delete immediately
      if (!domain) {
        thread.moveToTrash();
        console.log("invalid domain");
        break;
      }

      if (!isAllowedTopLevelDomain(domain)) {
        thread.moveToTrash();
        console.log("not allowed domain", domain);
        break;
      }

      if (isBlockedDomain(domain)) {
        thread.moveToTrash();
        console.log("blocked domain", domain);
        break;
      }

      if (!domainExists(domain)) {
        thread.moveToTrash();
        console.log("domain does not exist", domain);
        break;
      }

    }

  });

  console.log("purgeSpamFolder() ended");
}


// ===============================
// DOMAIN HELPERS
// ===============================

function extractDomain(fromHeader) {

  if (!fromHeader) return null;

  var match = fromHeader.match(/<([^>]+)>/);
  var email = match ? match[1] : fromHeader;

  var parts = email.split("@");

  if (parts.length < 2) return null;

  return normalizeDomain(parts[1]);
}


function normalizeDomain(domain) {
  if (!domain) return null;

  domain = domain.toLowerCase();

  //  invalid if contains spaces
  if (domain.indexOf(" ") !== -1) return null;

  //  invalid if trailing dot
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
// DOMAIN EXISTS (CACHED)
// ===============================

function domainExists(domain) {

  domain = normalizeDomain(domain);
  if (!domain) return false;

  //  known good → skip DNS
  if (KNOWN_GOOD_DOMAINS[domain]) {
    return true;
  }

  //  in-memory cache
  if (domainCache.hasOwnProperty(domain)) {
    return domainCache[domain];
  }

  var cache = CacheService.getScriptCache();

  //  persistent cache
  var cached = cache.get(domain);
  if (cached !== null) {
    var result = (cached === "true");
    domainCache[domain] = result;
    return result;
  }

  //  DNS lookup
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

  //  cache result
  domainCache[domain] = exists;

  var ttl = exists ? TTL_GOOD : TTL_BAD;
  cache.put(domain, exists.toString(), ttl);

  return exists;
}
