import type { User } from '../models/user.model';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        userId: string;
        token: string;
        dashboardAccess?: boolean;
        /**
         * The signed-in user's record, read once by the auth check so a
         * handler need not read it again. Without the profile photo, which
         * for older accounts is inline and large.
         */
        user?: Omit<User, 'profilePhotoUrl'>;
      };
    }
  }
}

export {};
