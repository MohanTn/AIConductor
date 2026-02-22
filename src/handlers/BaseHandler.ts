/**
 * Base handler class providing shared database access.
 * All specialized handlers extend this base to maintain consistency.
 */
export class BaseHandler {
  protected db: any; // Database connection shared from DatabaseHandler

  constructor(db: any) {
    this.db = db;
  }
}
