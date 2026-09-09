import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AuthError } from '../services/auth.service';
import { LeaveError } from '../services/leave.service';
import { AttendanceError } from '../services/attendance.service';
import { HolidayError } from '../services/holiday.service';
import { ReportingError } from '../services/reporting.service';
import { ManagerError } from '../services/manager.service';
import { OvertimeError } from '../services/overtime.service';
import { ReimbursementError } from '../services/reimbursement.service';
import { logger } from '../utils/logger';
import { AdminError } from '../services/admin.service';
import { ConnectError } from '../services/connect.service';
import { GameError } from '../services/game.service';
import { NotificationError } from '../services/notification.service';
import { PayHeadError } from '../services/payHead.service';
import { StatutoryError } from '../services/statutory.service';
import { SalaryStructureError } from '../services/salaryStructure.service';
import { SalaryTemplateError } from '../services/salaryTemplate.service';
import { PayrollRunError } from '../services/payrollRun.service';
import { PayrollInputsError } from '../services/payroll-inputs.service';
import { OrgSetupError } from '../services/orgSetup.service';
import { KpiError } from '../services/kpi.service';
import { ShiftError } from '../services/shift.service';
import { ReimbursementTypeError } from '../services/reimbursement-type.service';

export const notFoundHandler = (request: Request, response: Response) => {
  logger.warn('Route not found', requestLogContext(request, 404));
  response.status(404).json({
    success: false,
    message: `Route not found: ${request.method} ${request.originalUrl}`,
    requestId: request.requestId,
  });
};

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) => {
  void _next;

  const statusCode = getStatusCode(error);
  const expected = statusCode < 500;
  const context = requestLogContext(request, statusCode);
  if (expected) {
    logger.warn('Request rejected', context, error);
  } else {
    logger.error('Unhandled request error', context, error);
  }

  const internalMessage = error instanceof Error ? error.message : String(error);
  response.status(statusCode).json({
    success: false,
    message: expected && error instanceof Error ? error.message : 'Internal server error',
    requestId: request.requestId,
    ...(env.nodeEnv === 'production' || expected ? {} : { error: internalMessage }),
  });
};

function getStatusCode(error: unknown): number {
  if (
    error instanceof AuthError ||
    error instanceof LeaveError ||
    error instanceof AttendanceError ||
    error instanceof HolidayError ||
    error instanceof ReportingError ||
    error instanceof ManagerError ||
    error instanceof OvertimeError ||
    error instanceof ReimbursementError
    || error instanceof AdminError
    || error instanceof ConnectError
    || error instanceof GameError
    || error instanceof NotificationError
    || error instanceof PayHeadError
    || error instanceof StatutoryError
    || error instanceof SalaryStructureError
    || error instanceof SalaryTemplateError
    || error instanceof PayrollRunError
    || error instanceof PayrollInputsError
    || error instanceof OrgSetupError
    || error instanceof KpiError
    || error instanceof ShiftError
    || error instanceof ReimbursementTypeError
  ) {
    return error.statusCode;
  }
  return 500;
}

function requestLogContext(request: Request, statusCode: number) {
  return {
    requestId: request.requestId,
    method: request.method,
    path: request.originalUrl,
    statusCode,
    userId: request.auth?.userId,
    ip: request.ip,
  };
}
