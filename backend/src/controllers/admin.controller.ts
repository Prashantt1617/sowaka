import { NextFunction, Request, Response } from 'express';
import { attendanceReport, employeeCalendar } from '../services/attendance-report.service';
import { listDashboardAccesses, setDashboardAccess } from '../services/dashboard-access.service';
import {
  AttendanceError,
  adminDecideRegularization,
  listAllRegularizationsForAdmin,
  listOutOfLocationForAdmin,
} from '../services/attendance.service';
import { deleteOffice, listOffices, officeView, saveOffice } from '../services/geofence.service';
import { requireOrg } from '../services/shift.service';
import { adminDecideLeave, listAllLeavesForAdmin } from '../services/leave.service';
import { adminDecideOvertime, listAllOvertimeForAdmin } from '../services/overtime.service';
import {
  adminDecideReimbursement,
  listAllReimbursementsForAdmin,
} from '../services/reimbursement.service';
import {
  AdminError,
  addEmployeeDocument,
  createEmployeeForAdmin,
  removeEmployeeDocument,
  listAllEmployeesForAdmin,
  listAllFeedbackForAdmin,
  setOvertimeEligibilityForAdmin,
} from '../services/admin.service';
import { getCompanySettings, updateCompanySettings } from '../services/company-settings.service';

function adminUserId(req: Request): string {
  // requireAuth + requireDashboardAccess guarantee this is present.
  return req.auth!.userId;
}

// ---- Org-wide lists (rule 5) ----
export async function listLeaves(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, leaves: await listAllLeavesForAdmin(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function listOvertime(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, overtime: await listAllOvertimeForAdmin(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function listReimbursements(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, claims: await listAllReimbursementsForAdmin(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

/** Punches taken away from every office, for the "OOL check-ins" view. */
export async function listOutOfLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from ?? `${today.slice(0, 8)}01`);
    const to = String(req.query.to ?? today);
    res.status(200).json({ success: true, checkIns: await listOutOfLocationForAdmin(adminUserId(req), from, to) });
  } catch (error) {
    next(error);
  }
}

// ---- Offices: where a geotagged punch may be taken from ----
export async function listOfficesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await requireOrg(adminUserId(req));
    res.status(200).json({ success: true, offices: (await listOffices(org)).map(officeView) });
  } catch (error) {
    next(error);
  }
}

export async function saveOfficeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await requireOrg(adminUserId(req));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof req.params.officeId === 'string' ? req.params.officeId : undefined;
    const office = await saveOffice(org, {
      id,
      name: String(body.name ?? ''),
      city: typeof body.city === 'string' ? body.city : undefined,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      radiusMeters: body.radiusMeters === undefined ? undefined : Number(body.radiusMeters),
      active: body.active === undefined ? undefined : body.active === true,
    }).catch((error: Error) => { throw new AttendanceError(400, error.message); });
    res.status(id ? 200 : 201).json({ success: true, office: officeView(office) });
  } catch (error) {
    next(error);
  }
}

export async function deleteOfficeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await requireOrg(adminUserId(req));
    await deleteOffice(org, String(req.params.officeId ?? ''))
      .catch((error: Error) => { throw new AttendanceError(404, error.message); });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function listRegularizations(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      success: true,
      regularizations: await listAllRegularizationsForAdmin(adminUserId(req)),
    });
  } catch (error) {
    next(error);
  }
}

export async function listFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, feedback: await listAllFeedbackForAdmin(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

/** Reports › Attendance — a graded date range, grouped by capture format. */
export async function attendanceReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    res.status(200).json({
      success: true,
      report: await attendanceReport(adminUserId(req), { from: str(req.query.from), to: str(req.query.to) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, employees: await listAllEmployeesForAdmin(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

// ---- Company settings (week-off + per-team overtime) ----
export async function getCompanySettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, settings: await getCompanySettings(adminUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function updateCompanySettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await updateCompanySettings(adminUserId(req), {
      weekoffDays: req.body.weekoffDays,
      overtimeDisabledDepartments: req.body.overtimeDisabledDepartments,
    });
    res.status(200).json({ success: true, settings });
  } catch (error) {
    next(error);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await createEmployeeForAdmin(adminUserId(req), req.body ?? {});
    res.status(201).json({ success: true, employee });
  } catch (error) { next(error); }
}

/** One employee's month, day by day, as the app's calendar shows it. */
export async function employeeCalendarHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const calendar = await employeeCalendar(
      adminUserId(req),
      String(req.params.userId ?? ''),
      String(req.query.month ?? ''),
    );
    res.status(200).json({ success: true, calendar });
  } catch (error) { next(error); }
}

/** People › Accesses: everyone with dashboard access and their tabs. */
export async function listAccessesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, ...(await listDashboardAccesses(adminUserId(req))) });
  } catch (error) { next(error); }
}

/** Give, change or remove one person's dashboard access and tabs. */
export async function setAccessHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as { access?: unknown; admin?: unknown; tabs?: unknown };
    res.status(200).json({ success: true, ...(await setDashboardAccess(adminUserId(req), String(req.params.userId ?? ''), body)) });
  } catch (error) { next(error); }
}

/** HR files a document against an employee: one type, one file, appended. */
export async function addEmployeeDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const documents = await addEmployeeDocument(
      adminUserId(req),
      String(req.params.userId ?? ''),
      req.body?.type,
      req.file
        ? {
            originalName: req.file.originalname,
            contentType: req.file.mimetype,
            size: req.file.size,
            bytes: req.file.buffer,
          }
        : undefined,
    );
    res.status(201).json({ success: true, documents });
  } catch (error) { next(error); }
}

export async function removeEmployeeDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const documents = await removeEmployeeDocument(
      adminUserId(req),
      String(req.params.userId ?? ''),
      String(req.params.documentId ?? ''),
    );
    res.status(200).json({ success: true, documents });
  } catch (error) { next(error); }
}

/** HR toggles whether one employee may raise overtime requests. */
export async function updateOvertimeEligibility(req: Request, res: Response, next: NextFunction) {
  try {
    const eligible = req.body?.overtimeEligible;
    if (typeof eligible !== 'boolean') {
      throw new AdminError(400, 'overtimeEligible must be true or false');
    }
    const employee = await setOvertimeEligibilityForAdmin(
      adminUserId(req),
      String(req.params.userId ?? ''),
      eligible,
    );
    res.status(200).json({ success: true, employee });
  } catch (error) { next(error); }
}

// ---- Overrides (rules 6, 7, 8) ----
export async function decideLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await adminDecideLeave(adminUserId(req), String(req.params.leaveId ?? ''), {
      decision: String(req.body.decision ?? ''),
      managerNote: req.body.managerNote == null ? undefined : String(req.body.managerNote),
    });
    res.status(200).json({ success: true, leave });
  } catch (error) {
    next(error);
  }
}

export async function decideRegularization(req: Request, res: Response, next: NextFunction) {
  try {
    const regularization = await adminDecideRegularization(
      adminUserId(req),
      String(req.params.regularizationId ?? ''),
      {
        decision: String(req.body.decision ?? ''),
        managerNote: req.body.managerNote == null ? undefined : String(req.body.managerNote),
      },
    );
    res.status(200).json({ success: true, regularization });
  } catch (error) {
    next(error);
  }
}

export async function decideOvertime(req: Request, res: Response, next: NextFunction) {
  try {
    const overtime = await adminDecideOvertime(
      adminUserId(req),
      String(req.params.overtimeId ?? ''),
      {
        decision: String(req.body.decision ?? ''),
        managerNote: req.body.managerNote == null ? undefined : String(req.body.managerNote),
      },
    );
    res.status(200).json({ success: true, overtime });
  } catch (error) {
    next(error);
  }
}

export async function decideReimbursement(req: Request, res: Response, next: NextFunction) {
  try {
    const claim = await adminDecideReimbursement(
      adminUserId(req),
      String(req.params.claimId ?? ''),
      String(req.body.decision ?? ''),
      req.body.managerNote == null ? undefined : String(req.body.managerNote),
    );
    res.status(200).json({ success: true, claim });
  } catch (error) {
    next(error);
  }
}
