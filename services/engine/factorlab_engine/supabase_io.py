from __future__ import annotations

import time

from .repositories.client import ClientRepositoryMixin, DataIngestJob, Job
from .repositories.equity import EquityRepositoryMixin
from .repositories.ingest_job_scans import DataIngestJobScansRepositoryMixin
from .repositories.ingest_jobs import DataIngestJobsRepositoryMixin
from .repositories.ingest_legacy import LegacyIngestRepositoryMixin
from .repositories.jobs import JobsRepositoryMixin
from .repositories.prices import PricesRepositoryMixin
from .repositories.reports import ReportsRepositoryMixin
from .repositories.runs import RunsRepositoryMixin


class SupabaseIO(
    ClientRepositoryMixin,
    JobsRepositoryMixin,
    RunsRepositoryMixin,
    PricesRepositoryMixin,
    ReportsRepositoryMixin,
    LegacyIngestRepositoryMixin,
    EquityRepositoryMixin,
    DataIngestJobsRepositoryMixin,
    DataIngestJobScansRepositoryMixin,
):
    pass


__all__ = ["DataIngestJob", "Job", "SupabaseIO", "time"]
