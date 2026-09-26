import { NextFunction, Request, Response } from 'express';
import { attendanceReport, employeeCalendar } from '../services/attendance-report.service';
import {
  adminDecideRegularization,
  listAllRegularizationsForAdmin,
} from '../services/attendance.service';
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
