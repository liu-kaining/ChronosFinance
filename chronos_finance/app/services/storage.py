"""
Asynchronous object storage service for Cloudflare R2 (S3-compatible).

Implements cold-hot separation for large JSON payloads:
- Primary storage: R2 object storage (cold)
- Optional cache: PostgreSQL JSONB column (hot)

Features:
- Async upload/download using aioboto3
- Automatic retry with exponential backoff
- Content-type handling for JSON
- URL generation for direct access
"""

from __future__ import annotations

import json
import logging
from io import BytesIO
from typing import Any

import aioboto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()


class StorageError(Exception):
    """Base exception for storage operations."""
    pass


class UploadError(StorageError):
    """Failed to upload object to R2."""
    pass


class DownloadError(StorageError):
    """Failed to download object from R2."""
    pass


class StorageService:
    """
    Async R2 storage service with retry support.

    Usage:
        storage = StorageService()
        await storage.upload_json("sec_filings/AAPL/10-K/2023_FY.json", {"data": ...})
        data = await storage.download_json("sec_filings/AAPL/10-K/2023_FY.json")
    """

    def __init__(
        self,
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        bucket_name: str | None = None,
        region: str | None = None,
        max_retries: int = 3,
        retry_base_delay: float = 1.0,
    ):
        self._endpoint_url = endpoint_url or _settings.R2_ENDPOINT_URL
        self._access_key_id = access_key_id or _settings.R2_ACCESS_KEY_ID
        self._secret_access_key = secret_access_key or _settings.R2_SECRET_ACCESS_KEY
        self._bucket_name = bucket_name or _settings.R2_BUCKET_NAME
        self._region = region or _settings.R2_REGION
        self._max_retries = max_retries
        self._retry_base_delay = retry_base_delay
        self._session: aioboto3.Session | None = None

    @property
    def is_configured(self) -> bool:
        """Check if R2 storage is properly configured."""
        return bool(
            self._endpoint_url
            and self._access_key_id
            and self._secret_access_key
            and self._bucket_name
        )

    def _get_session(self) -> aioboto3.Session:
        """Get or create aioboto3 session."""
        if self._session is None:
            self._session = aioboto3.Session()
        return self._session

    async def upload_json(
        self,
        path: str,
        data: dict[str, Any] | list[Any],
        content_type: str = "application/json",
    ) -> str:
        """
        Upload JSON data to R2 with automatic retry.

        Args:
            path: Object path within bucket (e.g., "sec_filings/AAPL/10-K/2023_FY.json")
            data: JSON-serializable dict or list
            content_type: MIME type (default: application/json)

        Returns:
            Full R2 path (bucket/path)

        Raises:
            UploadError: If upload fails after all retries
        """
        if not self.is_configured:
            raise UploadError("R2 storage is not configured. Check R2_* environment variables.")

        # Serialize JSON
        try:
            json_bytes = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as e:
            raise UploadError(f"Failed to serialize JSON: {e}") from e

        session = self._get_session()
        config = Config(
            retries={"max_attempts": self._max_retries},
            connect_timeout=10,
            read_timeout=60,
        )

        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                async with session.client(
                    "s3",
                    endpoint_url=self._endpoint_url,
                    aws_access_key_id=self._access_key_id,
                    aws_secret_access_key=self._secret_access_key,
                    region_name=self._region,
                    config=config,
                ) as client:
                    await client.put_object(
                        Bucket=self._bucket_name,
                        Key=path,
                        Body=json_bytes,
                        ContentType=content_type,
                        Metadata={
                            "uploaded-by": "chronos-finance",
                            "attempt": str(attempt + 1),
                        },
                    )
                    logger.debug(
                        "Uploaded to R2: bucket=%s path=%s size=%d bytes",
                        self._bucket_name, path, len(json_bytes)
                    )
                    return f"{self._bucket_name}/{path}"

            except ClientError as e:
                last_error = e
                error_code = e.response.get("Error", {}).get("Code", "Unknown")
                logger.warning(
                    "R2 upload attempt %d/%d failed: %s (code=%s)",
                    attempt + 1, self._max_retries, str(e), error_code
                )
                if attempt < self._max_retries - 1:
                    import asyncio
                    delay = self._retry_base_delay * (2 ** attempt)
                    logger.info("Retrying in %.1f seconds...", delay)
                    await asyncio.sleep(delay)

            except Exception as e:
                last_error = e
                logger.exception("Unexpected error during R2 upload attempt %d", attempt + 1)
                if attempt < self._max_retries - 1:
                    import asyncio
                    delay = self._retry_base_delay * (2 ** attempt)
                    await asyncio.sleep(delay)

        raise UploadError(
            f"Failed to upload {path} to R2 after {self._max_retries} attempts: {last_error}"
        )

    async def download_json(self, path: str) -> dict[str, Any] | list[Any]:
        """
        Download JSON data from R2.

        Args:
            path: Object path within bucket

        Returns:
            Parsed JSON data

        Raises:
            DownloadError: If download or parsing fails
        """
        if not self.is_configured:
            raise DownloadError("R2 storage is not configured. Check R2_* environment variables.")

        session = self._get_session()
        config = Config(
            retries={"max_attempts": self._max_retries},
            connect_timeout=10,
            read_timeout=60,
        )

        try:
            async with session.client(
                "s3",
                endpoint_url=self._endpoint_url,
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name=self._region,
                config=config,
            ) as client:
                response = await client.get_object(
                    Bucket=self._bucket_name,
                    Key=path,
                )
                body = await response["Body"].read()
                return json.loads(body.decode("utf-8"))

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "NoSuchKey":
                raise DownloadError(f"Object not found: {path}") from e
            raise DownloadError(f"Failed to download {path}: {e}") from e

        except json.JSONDecodeError as e:
            raise DownloadError(f"Failed to parse JSON from {path}: {e}") from e

    async def delete(self, path: str) -> bool:
        """
        Delete object from R2.

        Args:
            path: Object path within bucket

        Returns:
            True if deleted, False if not found
        """
        if not self.is_configured:
            raise StorageError("R2 storage is not configured.")

        session = self._get_session()

        try:
            async with session.client(
                "s3",
                endpoint_url=self._endpoint_url,
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name=self._region,
            ) as client:
                await client.delete_object(Bucket=self._bucket_name, Key=path)
                return True

        except ClientError as e:
            logger.warning("Failed to delete %s: %s", path, e)
            return False

    async def exists(self, path: str) -> bool:
        """Check if object exists in R2."""
        if not self.is_configured:
            return False

        session = self._get_session()

        try:
            async with session.client(
                "s3",
                endpoint_url=self._endpoint_url,
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name=self._region,
            ) as client:
                await client.head_object(Bucket=self._bucket_name, Key=path)
                return True

        except ClientError:
            return False

    def get_public_url(self, path: str) -> str | None:
        """
        Get public URL for object (if bucket has public access).

        Note: For private buckets, use presigned URLs instead.
        """
        if not self._endpoint_url:
            return None
        # R2 public URL format: https://pub-<hash>.r2.dev/<path>
        # Or custom domain: https://assets.example.com/<path>
        # This method returns a generic S3-style URL
        return f"{self._endpoint_url}/{self._bucket_name}/{path}"

    async def get_presigned_url(self, path: str, expires_in: int = 3600) -> str:
        """
        Generate presigned URL for temporary access.

        Args:
            path: Object path
            expires_in: URL expiration in seconds (default: 1 hour)

        Returns:
            Presigned URL
        """
        if not self.is_configured:
            raise StorageError("R2 storage is not configured.")

        session = self._get_session()

        async with session.client(
            "s3",
            endpoint_url=self._endpoint_url,
            aws_access_key_id=self._access_key_id,
            aws_secret_access_key=self._secret_access_key,
            region_name=self._region,
        ) as client:
            return await client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket_name, "Key": path},
                ExpiresIn=expires_in,
            )


# Singleton instance for convenience
_storage_service: StorageService | None = None


def get_storage_service() -> StorageService:
    """Get singleton StorageService instance."""
    global _storage_service
    if _storage_service is None:
        _storage_service = StorageService()
    return _storage_service
