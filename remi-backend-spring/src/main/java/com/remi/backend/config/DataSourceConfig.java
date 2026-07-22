package com.remi.backend.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import javax.sql.DataSource;

/**
 * Two datasources:
 *  - ClickHouse (primary) — all span/session/analytics signal reads.
 *  - Postgres ("identity") — orgs, api_keys, audit_log, pii_policies.
 */
@Configuration
public class DataSourceConfig {

    private static HikariDataSource pool(String name, String url, String user, String pass, String driver) {
        HikariConfig cfg = new HikariConfig();
        cfg.setPoolName(name);
        cfg.setJdbcUrl(url);
        cfg.setUsername(user);
        cfg.setPassword(pass);
        cfg.setDriverClassName(driver);
        cfg.setMaximumPoolSize(10);
        cfg.setConnectionTimeout(10_000);
        cfg.setIdleTimeout(60_000);
        // Don't block app startup on a slow database; fail per-request instead.
        cfg.setInitializationFailTimeout(-1);
        return new HikariDataSource(cfg);
    }

    @Bean
    @Primary
    DataSource clickhouseDataSource(
            @Value("${remi.clickhouse.url}") String url,
            @Value("${remi.clickhouse.username}") String user,
            @Value("${remi.clickhouse.password}") String pass) {
        return pool("clickhouse", url, user, pass, "com.clickhouse.jdbc.ClickHouseDriver");
    }

    @Bean
    @Primary
    NamedParameterJdbcTemplate clickhouseJdbc(DataSource clickhouseDataSource) {
        return new NamedParameterJdbcTemplate(clickhouseDataSource);
    }

    @Bean
    @Qualifier("identity")
    DataSource identityDataSource(
            @Value("${remi.identity.url}") String url,
            @Value("${remi.identity.username}") String user,
            @Value("${remi.identity.password}") String pass) {
        return pool("identity", url, user, pass, "org.postgresql.Driver");
    }

    @Bean
    @Qualifier("identity")
    NamedParameterJdbcTemplate identityJdbc(@Qualifier("identity") DataSource identityDataSource) {
        return new NamedParameterJdbcTemplate(identityDataSource);
    }
}
