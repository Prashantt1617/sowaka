import compression from 'compression';
import cors from 'cors';
import express, { Request } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestContext } from './middleware/request-context.middleware';
import { router } from './routes';

export const app = express();

app.use(requestContext);
app.use(helmet());
app.use(
  cors({
    // The fixed list, plus any company's own subdomain of the product domain.
    // No Origin header (curl, native apps) passes as before.
    // The Care web pages call in with the person's token from wherever they
    // are hosted, so that host is allowed too.
    origin: (origin, done) =>
      done(
        null,
        !origin ||
          env.corsOrigins.includes(origin) ||
          env.isDashboardOrigin(origin) ||
          (env.careWebBase.length > 0 && origin === env.careWebBase),
      ),
  }),
);
// A month of attendance for a large org is over a megabyte of JSON and
// compresses ten to one; every other response is small enough not to notice.
app.use(compression());
app.use(express.json());
morgan.token('request-id', (req) => (req as Request).requestId ?? '-');
app.use(
  morgan(
    env.nodeEnv === 'production'
      ? ':remote-addr :method :url :status :response-time ms requestId=:request-id'
      : ':method :url :status :response-time ms requestId=:request-id',
  ),
);

app.use(router);

app.use(notFoundHandler);
app.use(errorHandler);
