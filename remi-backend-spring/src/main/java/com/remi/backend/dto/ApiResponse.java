package com.remi.backend.dto;

public record ApiResponse<T>(boolean success, T data) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data);
    }
    // Error responses are produced by GlobalErrorHandler as {success:false, error:<msg>}.
}
