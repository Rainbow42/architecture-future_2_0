import hudson.EnvVars
import hudson.model.Node
import hudson.slaves.CommandLauncher
import hudson.slaves.DumbSlave
import hudson.slaves.RetentionStrategy
import jenkins.model.Jenkins

def controller = Jenkins.get()
def privateRoot = System.getenv('TF_CI_PRIVATE_ROOT')
assert privateRoot
assert controller.getNode('future-terraform') == null
def launcher = new CommandLauncher("${privateRoot}/jenkins/tools/launch-linux-agent.sh", new EnvVars())
def agent = new DumbSlave('future-terraform', 'Isolated local Linux VM without host mounts',
    '/home/tonyamedved.guest/future-agent', '1', Node.Mode.EXCLUSIVE,
    'future-terraform', launcher, new RetentionStrategy.Always(), [])
controller.addNode(agent)
agent.toComputer().connect(false)
println('Local Linux agent configured; no jobs or cloud credentials added')
