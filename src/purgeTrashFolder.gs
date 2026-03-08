// This script irreversibly deleted messages older than 1 day from Trash that have invalid sender or sender from non-whitelisted domain
// Enable the Advanced Gmail service in Apps Script. The Apps Script docs say advanced services must be enabled before use. It is required to delete messages from Trash folder
// In the editor: Services->Gmail API->Add

function purgeTrashFolder() {
  var threads = GmailApp.search('in:trash older_than:1d');

  threads.forEach(function(thread) {
    var messages = thread.getMessages();

    for (var i = 0; i < messages.length; i++) {
      var from = messages[i].getFrom();
      var domain = extractDomain(from);

      if (domain && !isAllowedDomain(domain)) {
        Gmail.Users.Threads.remove('me', thread.getId());
        return;
      }

      if (!domainExists(domain)) {
        Gmail.Users.Threads.remove('me', thread.getId());
        return;
      }
    }
  });
}

function extractDomain(fromHeader) {
  var match = fromHeader.match(/<([^>]+)>/);
  var email = match ? match[1] : fromHeader;
  var parts = email.split("@");
  if (parts.length < 2) return null;
  return parts[1].toLowerCase();
}

function isAllowedDomain(domain) {
  return (
    domain.endsWith(".com") ||
    domain.endsWith(".net") ||
    domain.endsWith(".org") ||
    domain.endsWith("example.tld")
  );
}

function domainExists(domain) {
  try {
    var url = "https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=MX";
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    return !!(data.Answer && data.Answer.length > 0);
  } catch (e) {
    return false;
  }
}
