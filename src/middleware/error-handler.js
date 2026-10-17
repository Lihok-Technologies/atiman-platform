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
  // The response body below is deliberately NOT changed: altering `message`
  // would change the error contract of every route in the application, which is
  // outside this remediation's bounded scope. That residual channel is recorded
  // as an open finding rather than silently changed.
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

  if (isApiRequest) {
    res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } else {
    res.status(statusCode).render('error', {
      title: 'Error',
      message,
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
