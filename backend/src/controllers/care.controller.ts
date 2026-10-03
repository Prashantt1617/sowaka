import { NextFunction, Request, Response } from 'express';
import { getPairQuiz, getPartnerQuiz, removePairQuiz, saveMyAnswers, savePartnerAnswers, sharePairLink } from '../services/pair-quiz.service';
import { addEntry, careCatalog, CareError, deleteEntry, deleteWriting, getCatalog, listJournal, listWritings, putWriting, updateEntry } from '../services/care.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new CareError(401, 'Authentication required');
  return req.auth.userId;
}

export async function catalogHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, catalog: await getCatalog(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function publicCatalogHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    // Nothing personal here, and the web pages may be served from a host that
    // is not on the CORS list yet, so any page may read it.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ success: true, catalog: await careCatalog() });
  } catch (error) {
    next(error);
  }
}

export async function listWritingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, writings: await listWritings(requireUserId(req), String(req.query.prefix ?? '')) });
  } catch (error) {
    next(error);
  }
}

export async function putWritingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, writing: await putWriting(requireUserId(req), req.params.key, body.fields) });
  } catch (error) {
    next(error);
  }
}

export async function deleteWritingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteWriting(requireUserId(req), req.params.key);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listJournalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await listJournal(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function addEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const entry = await addEntry(requireUserId(req), { text: body.text, prompt: body.prompt, context: body.context });
    res.status(201).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
}

export async function updateEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const entry = await updateEntry(requireUserId(req), String(req.params.id ?? ''), { text: body.text });
    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
}

export async function deleteEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteEntry(requireUserId(req), String(req.params.id ?? ''));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// The quizzes for two: love languages and attachment styles.

export async function getPairQuizHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, quiz: await getPairQuiz(requireUserId(req), req.params.kind) });
  } catch (error) {
    next(error);
  }
}

export async function saveMyAnswersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, quiz: await saveMyAnswers(requireUserId(req), req.params.kind, body.answers) });
  } catch (error) {
    next(error);
  }
}

export async function sharePairLinkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, quiz: await sharePairLink(requireUserId(req), req.params.kind) });
  } catch (error) {
    next(error);
  }
}

export async function removePairQuizHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await removePairQuiz(requireUserId(req), req.params.kind);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/** The partner's link: no sign-in; the link is the key. */
export async function getPartnerQuizHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, quiz: await getPartnerQuiz(req.params.code) });
  } catch (error) {
    next(error);
  }
}

export async function savePartnerAnswersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, quiz: await savePartnerAnswers(req.params.code, body.answers, body.name) });
  } catch (error) {
    next(error);
  }
}
