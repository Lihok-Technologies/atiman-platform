/**
 * Error Handling Middleware
 */

const util = require('util');
const { redactCredentialText } = require('../utils/helpers');

const errorHandler = (err, req, res, next) => {
  // ATM-001-SEC-B3B: a database driver can echo a bind parameter back inside an
  // error - `pg` reports a failed cast as `invalid input syntax for type
  // integer: "<the value>"` - so printing the whole error object printed the
  // value. The logged form keeps every diagnostic field (name, message, code,
  // stack, driver metadata) and withholds only credential-shaped substrings.
  //
  // Both the log and the response body can carry a driver-echoed credential
  // (`pg` reports a failed cast as `invalid input syntax ... "<the value>"`).
  // The log is redacted here; the response `message` is redacted below so the
  // same value cannot leave through the JSON/HTML error body. Status codes,
  // the envelope shape, and every non-credential message are unchanged.
  console.error('Error:', redactCredentialText(util.inspect(err)));

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Duplicate entry - record already exists';
  } else if (err.code === 'ER_NO_REFERENCED_ROW') {
    statusCode = 400;
    message = 'Referenced record not found';
  }

  // Check if request expects JSON (API) or HTML (web)
  const acceptHeader = req.headers.accept || '';
  const isApiRequest = req.xhr || 
                       req.path.startsWith('/api/') || 
                       acceptHeader.includes('application/json');

  const safeMessage = redactCredentialText(message);

  if (isApiRequest) {
    res.status(statusCode).json({
      success: false,
      message: safeMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } else {
    res.status(statusCode).render('error', {
      title: 'Error',
      message: safeMessage,
      statusCode,
      user: req.user
    });
  }
};

// 404 handler
const notFound = (req, res, next) => {
  console.log('[404] Not Found:', req.method, req.originalUrl);
  const err = new Error('Not Found');
  err.statusCode = 404;
  next(err);
};

module.exports = {
  errorHandler,
  notFound
};
