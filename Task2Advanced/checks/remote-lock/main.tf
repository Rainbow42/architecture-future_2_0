terraform {
  required_version = "= 1.12.2"
  backend "s3" {}
}

resource "terraform_data" "lock_probe" {
  input = "synthetic-lock-probe"

  provisioner "local-exec" {
    command = "sleep 15"
  }
}
