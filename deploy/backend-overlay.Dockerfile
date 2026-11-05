# Build an application-enabled platform image without copying platform source here.
ARG PLATFORM_IMAGE
FROM ${PLATFORM_IMAGE}
WORKDIR /app
COPY core/modules/finance /app/core/modules/finance
COPY assets/finance /app/assets/finance
COPY assets/domain-applications/finance /app/assets/domain-applications/finance
