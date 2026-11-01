from mangum import Mangum

from api.factory import build_app
from api.routes import search_router

handler = Mangum(build_app(search_router), lifespan="off")
