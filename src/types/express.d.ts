import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by the `identify` middleware on authenticated routes. */
    userId: string;
    /** The raw bearer token of the current request (used by logout). */
    token: string;
  }
}
