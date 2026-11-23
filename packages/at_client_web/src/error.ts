/** The collection codes (`COLLECTION_*`) a collection call can fail with. */
export type CollectionErrorCode =
  /** An argument is missing or malformed. */
  | 'COLLECTION_INVALID_ARGUMENT'
  /** No item has this id and owner. */
  | 'COLLECTION_ITEM_NOT_FOUND'
  /** The item belongs to another atSign, which the call may not change. */
  | 'COLLECTION_ITEM_NOT_OWNER'
  /** `create` named an id that exists. */
  | 'COLLECTION_ITEM_ALREADY_EXISTS'
  /** `remove` without `cascade` on an item that has sub-items. */
  | 'COLLECTION_ITEM_HAS_SUB_ITEMS'
  /** A record could not be read on this device. */
  | 'COLLECTION_ITEM_UNREADABLE'
  /** The item's data nests more than 64 levels. */
  | 'COLLECTION_ITEM_TOO_DEEP'
  /** The collection's type does not match the one its items carry. */
  | 'COLLECTION_TYPE_MISMATCH'
  /** `update` on an item of another type. */
  | 'COLLECTION_ITEM_WRONG_TYPE'
  /** Some key-level writes of one call failed; `failures` lists them. */
  | 'COLLECTION_PARTIAL_FAILURE'
  /** Any other collection failure; `kind` names the underlying error. */
  | 'COLLECTION_FAILED';

/** The reasons an `AtClient` call can fail; apps branch on these, never on message text. */
export type AtErrorCode =
  /** The atServer refused this enrollment's PKAM login. */
  | 'pkam_refused'
  /** The client did not come online. */
  | 'offline'
  /** The enrollment is not complete; it is pending approval. */
  | 'onboarding_incomplete'
  /** The enrollment request was denied, or the pairing call was refused by the atServer. */
  | 'enrollment_denied'
  /** `approve` or `deny` named an enrollment id whose decision is already in flight; nothing was sent. */
  | 'enrollment_in_flight'
  /** Approval or denial was accepted by the atServer, but delivering the response failed. */
  | 'enrollment_conveyance_failed'
  /** The client is closed. */
  | 'closed'
  /** This page, option, key file or session cannot do what was asked. */
  | 'unsupported'
  /** Any failure with no code of its own. */
  | 'internal'
  /** A key or the `.atKeys` document is malformed. */
  | 'bad_key'
  /** A caller mistake: a malformed argument, an invalid namespace, regex or owner, or non-plain data. The message names the parameter, never its value. */
  | 'invalid_argument'
  /** A subscription buffered more than 4096 events the app did not consume. */
  | 'overflow'
  | CollectionErrorCode;

const codes: ReadonlySet<string> = new Set<AtErrorCode>([
  'pkam_refused',
  'offline',
  'onboarding_incomplete',
  'enrollment_denied',
  'enrollment_in_flight',
  'enrollment_conveyance_failed',
  'closed',
  'unsupported',
  'internal',
  'bad_key',
  'invalid_argument',
  'overflow',
  'COLLECTION_INVALID_ARGUMENT',
  'COLLECTION_ITEM_NOT_FOUND',
  'COLLECTION_ITEM_NOT_OWNER',
  'COLLECTION_ITEM_ALREADY_EXISTS',
  'COLLECTION_ITEM_HAS_SUB_ITEMS',
  'COLLECTION_ITEM_UNREADABLE',
  'COLLECTION_ITEM_TOO_DEEP',
  'COLLECTION_TYPE_MISMATCH',
  'COLLECTION_ITEM_WRONG_TYPE',
  'COLLECTION_PARTIAL_FAILURE',
  'COLLECTION_FAILED',
]);

/** One key-level write of a collection call that failed. */
export interface AtErrorFailure {
  op: string;
  /** The atSign the failed copy was for. */
  recipient: string;
  kind: string;
}

/** What a collection failure adds to an `AtError`, where it applies. */
export interface AtErrorDetails {
  /** The item the failure is about. */
  id?: string;
  /** The atSign that owns that item. */
  owner?: string;
  /** For `COLLECTION_FAILED` and each failure: the underlying error's type. */
  kind?: string;
  /** For `COLLECTION_PARTIAL_FAILURE`: one entry per failed write. */
  failures?: AtErrorFailure[];
}

/** The error every `AtClient` call rejects with; branch on `code`. */
export class AtError extends Error implements AtErrorDetails {
  /** Which failure this is; see `AtErrorCode`. */
  code: AtErrorCode;
  id?: string;
  owner?: string;
  kind?: string;
  failures?: AtErrorFailure[];

  constructor(message: string, code: AtErrorCode, details: AtErrorDetails = {}) {
    super(message);
    this.name = 'AtError';
    this.code = code;
    if (details.id !== undefined) this.id = details.id;
    if (details.owner !== undefined) this.owner = details.owner;
    if (details.kind !== undefined) this.kind = details.kind;
    if (details.failures !== undefined) this.failures = details.failures;
  }
}

function details(reason: Record<string, unknown>): AtErrorDetails {
  const found: AtErrorDetails = {};
  if (typeof reason.id === 'string') found.id = reason.id;
  if (typeof reason.owner === 'string') found.owner = reason.owner;
  if (typeof reason.kind === 'string') found.kind = reason.kind;
  if (Array.isArray(reason.failures)) {
    found.failures = reason.failures.map((f) => ({ ...(f as AtErrorFailure) }));
  }
  return found;
}

/**
 * The `AtError` for whatever a bridge call rejected or threw: a `{code,
 * message}` object keeps its code when it is a known one; anything else is
 * `internal`.
 */
export function toAtError(reason: unknown): AtError {
  if (reason instanceof AtError) return reason;
  if (typeof reason === 'object' && reason !== null) {
    const { code, message } = reason as { code?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message : String(reason);
    if (typeof code === 'string' && codes.has(code)) {
      return new AtError(text, code as AtErrorCode, details(reason as Record<string, unknown>));
    }
    return new AtError(text, 'internal');
  }
  return new AtError(String(reason), 'internal');
}
