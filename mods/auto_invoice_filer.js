/**
 * EnclaveMail User Mod: Auto-Invoice Filer
 * 
 * This script runs locally inside your laptop.
 * Whenever an email with an invoice arrives, it auto-tags it and flags it for tax records.
 */

export function onReceiveEmail(email, actions) {
  const subject = email.subject.toLowerCase();
  
  if (subject.includes('invoice') || subject.includes('receipt') || subject.includes('billing')) {
    console.log(`[Mod: Auto-Invoice] Detected financial record: "${email.subject}"`);
    
    // 1. Apply local tag
    actions.applyTag('Tax-Deductible');
    
    // 2. If it has attachments, notify user
    if (email.attachments && email.attachments.length > 0) {
      console.log(`[Mod: Auto-Invoice] Found ${email.attachments.length} attachment(s).`);
    }
  }
}
