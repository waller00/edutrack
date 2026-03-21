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
              apt-get update
              apt-get install -y docker.io docker-compose
              systemctl start docker
              systemctl enable docker
              EOF
}

# Esto nos va a mostrar la IP en la consola cuando termine
output "ip_del_servidor" {
  value       = digitalocean_droplet.edutrack_vm.ipv4_address
  description = "La IP pública de tu servidor EduTrack"
}