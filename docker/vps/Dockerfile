# A fresh "VPS": Ubuntu 24.04 with systemd as PID 1, like the image a
# hosting provider gives you. SolarOps and its dependencies (nginx, certbot,
# Node.js, pm2...) are NOT pre-installed: deploy/install.sh installs them,
# exactly as on a real server (see install-solarops.sh).
FROM ubuntu:24.04

ENV container=docker \
    DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# What a provider image usually ships with, plus rsync for the source copy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus sudo \
      ca-certificates curl gnupg git rsync \
      iproute2 procps less nano dnsutils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Units that make no sense in a container.
RUN find /etc/systemd/system /lib/systemd/system -path '*.wants/*' \
      \( -name '*getty*' -o -name '*apt-daily*' -o -name '*systemd-timesyncd*' \
         -o -name '*systemd-logind*' -o -name '*udev*' -o -name '*systemd-firstboot*' \) \
      -exec rm -f {} \; \
 && systemctl mask dev-hugepages.mount sys-fs-fuse-connections.mount systemd-remount-fs.service \
 && systemctl set-default multi-user.target

COPY install-solarops.sh /usr/local/bin/install-solarops
RUN chmod 0755 /usr/local/bin/install-solarops

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
