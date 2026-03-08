# Gmail Spam Folder Purge Script
# Gmail Trash Folder Purge Script

A **Google Apps Script** that automatically scans the **Spam folder** and moves suspicious messages to **Trash** based on sender domain validation.

The script is designed for users receiving **large volumes of spam** with random or disposable domains.
It runs periodically and applies simple validation rules to detect suspicious senders.

---

## Features

* Scans messages in **Gmail Spam folder** and **Gmail Trash folder**
* Extracts the **sender domain** from the `From` header
* Allows only specific trusted domain suffixes
* Validates domain existence using **DNS MX lookup**
* Moves suspicious messages to **Trash** (not permanently deleted)
* Designed to run automatically every **5 minutes**

---

## Detection Rules

A message is moved to **Trash** if:

1. The sender domain **does not end with one of the allowed TLDs**

Allowed domains:

```
.com
.net
.org
.example.tld
```

OR

2. The domain **does not exist in DNS** (no MX records)

DNS validation uses **Google DNS over HTTPS**:

```
https://dns.google/resolve
```

---

## Script Logic

Workflow:

```
Spam Folder
     │
     ├── Extract sender domain
     │
     ├── Check allowed domain suffix
     │
     ├── Check DNS MX records
     │
     └── Move thread to Trash if suspicious
```

---

## Installation

### 1. Create a Google Apps Script

Go to:

```
https://script.google.com
```

Create a new project and paste the script.

---

### 2. Enable Required Services

No additional APIs are required.

The script uses:

```
GmailApp
UrlFetchApp
```

---

### 3. Add Trigger

In Apps Script:

```
Triggers → Add Trigger
```

Configuration:

| Setting      | Value             |
| ------------ | ----------------- |
| Function     | `purgeSpamFolder` |
| Event Source | Time-driven       |
| Type         | Every 5 minutes   |

---

## Performance Notes

| Spam volume | Runtime    |
| ----------- | ---------- |
| 100 emails  | <1 second  |
| 500 emails  | ~3 seconds |
| 1000 emails | ~8 seconds |

DNS queries are the most expensive operation.

---

## Security Notes

This script **does not permanently delete messages**.

Instead it moves suspicious messages to:

```
Trash
```

Messages remain recoverable for **30 days**.

---

## Limitations

* DNS check only verifies **MX records**
* Legitimate domains without MX may be flagged
* Script processes threads rather than individual messages

---

## Possible Improvements

Future enhancements could include:

* DNS result caching (improves performance)
* Detection of **randomized spam domains**
* Validation of **SPF / DKIM / DMARC**
* Analysis of **sending IP from headers**
* Detection of common spam landing pages

---

## License

MIT License
