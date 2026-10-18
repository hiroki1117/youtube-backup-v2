from mangum import Mangum

from api.factory import build_app
from api.routes import backup_router

handler = Mangum(build_app(backup_router), lifespan="off")
