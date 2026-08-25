// Custom application errors with HTTP status mapping.

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export interface ApiError {
  success: false;
  message: string;
  error: { message: string; code: string; details?: unknown };
}

export function buildErrorResponse(error: unknown): { response: ApiError; status: number } {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      response: {
        success: false,
        message: error.message,
        error: { message: error.message, code: error.code },
      },
    };
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return {
      status: 400,
      response: {
        success: false,
        message: 'Validation failed',
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: (error as unknown as { errors: unknown[] }).errors,
        },
      },
    };
  }
  return {
    status: 500,
    response: {
      success: false,
      message: 'Internal server error',
      error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
    },
  };
}
