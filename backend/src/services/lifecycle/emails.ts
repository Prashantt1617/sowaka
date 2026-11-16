// STUB — replaced by el/be-offer at merge
/**
 * The lifecycle's email (CONTRACT decision 13): the same company gate as
 * isAllowedRecipient applies to the org (EMAIL_ORGS), without a users row.
 * This stub sends nothing: every email is logged and kept in an in-memory
 * outbox that the check scripts read.
 */
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface LifecycleAttachment { filename: string; content: Buffer; contentType?: string }
export interface LifecycleOutboxEntry { org: string; to: string; subject: string; html: string; attachments: LifecycleAttachment[]; at: Date }

const outbox: LifecycleOutboxEntry[] = [];

export async function sendLifecycleEmail(org: string, to: string, subject: string, html: string, attachments: LifecycleAttachment[] = []): Promise<boolean> {
  if (env.emailOrgs.length > 0 && !env.emailOrgs.includes(org)) {
    logger.info('Lifecycle email suppressed: the company is outside EMAIL_ORGS', { org });
    return false;
  }
  outbox.push({ org, to, subject, html, attachments, at: new Date() });
  logger.info('Lifecycle email (stub, not sent)', { org, subject, attachments: attachments.length });
  return true;
}

export function lifecycleOutbox(): LifecycleOutboxEntry[] {
  return outbox;
}
