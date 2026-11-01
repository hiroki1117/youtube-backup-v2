from mangum import Mangum

from api.factory import build_app
from api.routes import comment_router

handler = Mangum(build_app(comment_router), lifespan="off")
