terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# Esta variable recibe el token de DigitalOcean
variable "do_token" {
  description = "DigitalOcean API Token"
  type        = string
  sensitive   = true
}

provider "digitalocean" {
  token = var.do_token
}

# 1. AMBIENTE DE PRODUCCIÓN (El servidor original)
resource "digitalocean_droplet" "edutrack_vm" {
  image  = "ubuntu-22-04-x64"
  name   = "edutrack-production"
  region = "nyc3"
  size   = "s-1vcpu-2gb" # 2GB RAM

  # Script de inicialización para Docker
  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y docker.io docker-compose
              systemctl start docker
              systemctl enable docker
              EOF
}

# 2. AMBIENTE DE TESTING / UAT (Idéntico a producción)
resource "digitalocean_droplet" "edutrack_testing" {
  image  = "ubuntu-22-04-x64"
  name   = "edutrack-testing"
  region = "nyc3"
  size   = "s-1vcpu-2gb" # Exactamente igual a producción

  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y docker.io docker-compose
              systemctl start docker
              systemctl enable docker
              EOF
}

# --- OUTPUTS ---
# Esto te mostrará ambas IPs en la consola al finalizar

output "ip_produccion" {
  value       = digitalocean_droplet.edutrack_vm.ipv4_address
  description = "IP pública del servidor de PRODUCCIÓN"
}

output "ip_testing" {
  value       = digitalocean_droplet.edutrack_testing.ipv4_address
  description = "IP pública del servidor de TESTING / UAT"
}