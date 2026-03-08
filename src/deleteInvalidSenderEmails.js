// Change your filter as you want. This script should run every 10 min - 1 h, it doesn't make sense to filter old messages

function deleteInvalidSenderEmails() {

  var threads = GmailApp.search('in:inbox newer_than:1d');

  threads.forEach(function(thread) {

    var messages = thread.getMessages();

    messages.forEach(function(message) {

      var from = message.getFrom();

      var domain = extractDomain(from);

      if (domain && !isAllowedTopLevelDomain(domain)) {
        thread.moveToTrash();
        return;
      }

      if (domain && isBlockedDomain(domain)) {
        thread.moveToTrash();
        return;
      }

      if (!domainExists(domain)) {
        thread.moveToTrash();
        return;
      }

    });

  });

}


function extractDomain(fromHeader) {

  var emailMatch = fromHeader.match(/<([^>]+)>/);

  var email = emailMatch ? emailMatch[1] : fromHeader;

  var parts = email.split("@");

  if (parts.length < 2) return null;

  return parts[1].toLowerCase();

}

function isAllowedTopLevelDomain(domain) {

  return (
    domain.endsWith(".com") ||
    domain.endsWith(".net") ||
    domain.endsWith(".org") ||
    domain.endsWith(".gov") ||
    domain.endsWith(".allowedexample.tld")
  );

}

function isBlockedDomain(domain) {

  return (
    domain.endsWith(".tk") ||
    domain.endsWith(".xxx") ||
    domain.endsWith(".spam") ||
    domain.endsWith(".blockedexample.tld")
  );

}

function extractDomain(fromHeader) {

  var match = fromHeader.match(/<([^>]+)>/);
  var email = match ? match[1] : fromHeader;

  var parts = email.split("@");

  if (parts.length < 2) return null;

  return parts[1].toLowerCase();
}


function domainExists(domain) {

  try {

    var url = "https://dns.google/resolve?name=" + domain + "&type=MX";

    var response = UrlFetchApp.fetch(url, {muteHttpExceptions: true});

    var data = JSON.parse(response.getContentText());

    if (data.Answer && data.Answer.length > 0) {
      return true;
    }

  } catch(e) {}

  return false;

}
