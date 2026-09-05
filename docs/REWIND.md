# Rewind

BugCapture keeps an in-memory circular buffer of the most recent two minutes. The buffer is local-only and is trimmed in increments of at least ten seconds. It is never uploaded; exporting a report explicitly includes only the evidence selected by the user.
