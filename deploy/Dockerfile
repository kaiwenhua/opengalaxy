# Static OpenGalaxy image (serves plain HTTP on port 80).
# Put it behind a reverse proxy that terminates HTTPS. WebHID needs HTTPS.
#
#   npm run build
#   docker build -f deploy/Dockerfile -t opengalaxy .
#   docker run -d --name opengalaxy -p 8080:80 --restart unless-stopped opengalaxy

FROM nginx:1.27-alpine

COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 80
