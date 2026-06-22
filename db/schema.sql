-- Run this once against MDW01-13\SAGE300 to set up the FenevisionRequests database.
-- Safe to re-run: skips creation of objects that already exist.

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'FenevisionRequests')
BEGIN
    CREATE DATABASE FenevisionRequests;
END
GO

USE FenevisionRequests;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'requests')
BEGIN
    CREATE TABLE requests (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        submitted_by        NVARCHAR(200)   NOT NULL,
        submitted_by_email  NVARCHAR(200)   NOT NULL,
        request_type        NVARCHAR(100)   NOT NULL,
        description         NVARCHAR(MAX)   NOT NULL,
        urgency             NVARCHAR(20)    NOT NULL,
        notes               NVARCHAR(MAX)   NULL,
        status              NVARCHAR(20)    NOT NULL DEFAULT 'pending', -- pending | approved | rejected
        current_step        INT             NOT NULL DEFAULT 1,
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'approvals')
BEGIN
    CREATE TABLE approvals (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        request_id      INT             NOT NULL FOREIGN KEY REFERENCES requests(id),
        approver_email  NVARCHAR(200)   NOT NULL,
        approver_name   NVARCHAR(200)   NOT NULL,
        step_number     INT             NOT NULL,
        status          NVARCHAR(20)    NOT NULL DEFAULT 'pending', -- pending | approved | rejected | skipped
        token           NVARCHAR(100)   NOT NULL,
        comments        NVARCHAR(MAX)   NULL,
        decided_at      DATETIME2       NULL,
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_approvals_request_id ON approvals(request_id);
    CREATE UNIQUE INDEX IX_approvals_token ON approvals(token);
END
GO
