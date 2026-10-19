import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom

def root = System.getenv('TF_CI_PRIVATE_ROOT')
assert root && new File(root).isAbsolute()
def passwordFile = new File(root, 'jenkins-admin.secret')
def permissions = PosixFilePermissions.fromString('rw-------')
def jenkins = Jenkins.get()
def realm = new HudsonPrivateSecurityRealm(false)
if (!passwordFile.exists()) {
    assert hudson.model.User.getById('tonya', false) == null
    def bytes = new byte[32]
    new SecureRandom().nextBytes(bytes)
    Files.createFile(passwordFile.toPath(), PosixFilePermissions.asFileAttribute(permissions))
    passwordFile.text = bytes.encodeHex().toString()
    realm.createAccount('tonya', passwordFile.text.trim())
}
assert hudson.model.User.getById('tonya', false) != null
Files.setPosixFilePermissions(passwordFile.toPath(), permissions)
jenkins.setSecurityRealm(realm)
def authorization = new FullControlOnceLoggedInAuthorizationStrategy()
authorization.setAllowAnonymousRead(false)
jenkins.setAuthorizationStrategy(authorization)
jenkins.setNumExecutors(0)
jenkins.setSlaveAgentPort(-1)
JenkinsLocationConfiguration.get().setUrl('http://127.0.0.1:18080/')
jenkins.save()
println('Local Jenkins security configured; anonymous access and inbound agent port disabled.')
