terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# Esta variable va a recibir el token que generamos recién
variable "do_token" {
  description = "DigitalOcean API Token"
  type        = string
  sensitive   = true
}

provider "digitalocean" {
  token = var.do_token
}

# Definimos el Droplet (el servidor físico en la nube)
resource "digitalocean_droplet" "edutrack_vm" {
  image  = "ubuntu-22-04-x64"
  name   = "edutrack-production"
  region = "nyc3" # Nueva York, lo más estable para nosotros
  size   = "s-1vcpu-2gb" # 2GB de RAM: corre Next.js, Postgres y Auth sin transpirar

  # Este script corre APENAS se prende la máquina por primera vez
  user_data = <<-EOF
              #!/bin/bash
              set -euo pipefail
              apt-get update
              apt-get install -y ca-certificates curl gnupg
              install -m 0755 -d /etc/apt/keyrings
              curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
              chmod a+r /etc/apt/keyrings/docker.gpg
              echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list
              apt-get update
              apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
              systemctl start docker
              systemctl enable docker
              EOF
}

# Esto nos va a mostrar la IP en la consola cuando termine
output "ip_del_servidor" {
  value       = digitalocean_droplet.edutrack_vm.ipv4_address
  description = "La IP pública de tu servidor EduTrack"
}