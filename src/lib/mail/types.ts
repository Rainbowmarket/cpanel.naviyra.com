export const MAIL_FOLDERS = [
  "INBOX",
  "Drafts",
  "Sent",
  "Trash",
  "Archive",
  "Junk",
] as const;

export type MailFolder = (typeof MAIL_FOLDERS)[number];

export type MailMessage = {
  id: string;
  folder: MailFolder;
  from: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  body: string;
  date: string;
  read: boolean;
  /** Folder before Trash/Junk — used by Restore. */
  originalFolder?: MailFolder;
  attachments?: MailAttachmentMeta[];
  /** Internal Maildir metadata (not shown in UI). */
  _maildirFile?: string;
  _maildirNew?: boolean;
};

export type MailAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
};

export type MailAttachmentPayload = {
  filename: string;
  contentType?: string;
  contentBase64: string;
  size?: number;
};

export type MailFolderCounts = Record<MailFolder, number>;

export const FOLDER_LABELS: Record<MailFolder, string> = {
  INBOX: "Inbox",
  Drafts: "Drafts",
  Sent: "Sent",
  Trash: "Trash",
  Archive: "Archive",
  Junk: "Junk",
};
