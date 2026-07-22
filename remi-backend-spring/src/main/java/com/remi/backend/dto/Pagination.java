package com.remi.backend.dto;

public record Pagination(int limit, int offset, long total, boolean hasMore) {
    public static Pagination of(int limit, int offset, long total) {
        return new Pagination(limit, offset, total, offset + limit < total);
    }
}
