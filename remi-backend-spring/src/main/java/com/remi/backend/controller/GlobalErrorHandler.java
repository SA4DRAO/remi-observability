package com.remi.backend.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalErrorHandler.class);

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(errorBody(ex));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        // Spring signals unknown paths, wrong methods and unsupported media types with
        // exceptions that already carry the right status (ErrorResponse). Honour it —
        // otherwise a 404 is reported as a 500, and every scanner hit looks like a bug.
        if (ex instanceof ErrorResponse er) {
            return ResponseEntity.status(er.getStatusCode()).body(errorBody(ex));
        }
        log.error("Unhandled error", ex);
        return ResponseEntity.internalServerError().body(errorBody(ex));
    }

    // Map.of rejects null values, so an exception with a null message (e.g. a bare
    // NullPointerException) would make this handler itself throw. Fall back to the
    // exception type name so the error envelope is always well-formed.
    private static Map<String, Object> errorBody(Exception ex) {
        String message = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        return Map.of("success", false, "error", message);
    }
}
