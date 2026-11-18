/** Errors `reviewItem` throws, each with a code and the HTTP status a route maps it to. */

export class ReviewValidationError extends Error {
  readonly code = "INVALID_FIELDS";
  /** The HTTP status a route maps this to. */
  readonly status = 400;
  /** Messages keyed by field path; `_form` for problems not tied to one field. */
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super(`Invalid review fields: ${Object.keys(fields).join(", ")}.`);
    this.name = "ReviewValidationError";
    this.fields = fields;
  }
}

export class ItemNotFound extends Error {
  readonly code = "ITEM_NOT_FOUND";
  /** The HTTP status a route maps this to. */
  readonly status = 404;
  readonly itemId: string;

  constructor(itemId: string) {
    super(`No item ${itemId}.`);
    this.name = "ItemNotFound";
    this.itemId = itemId;
  }
}

export class ConcurrentChange extends Error {
  readonly code = "CONCURRENT_CHANGE";
  /** The HTTP status a route maps this to. */
  readonly status = 409;
  readonly itemId: string;

  constructor(itemId: string) {
    super(`Item ${itemId} changed while it was being reviewed.`);
    this.name = "ConcurrentChange";
    this.itemId = itemId;
  }
}
