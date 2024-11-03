import { AmplicationLogger } from "@amplication/util/nestjs/logging";
import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { EnumOutdatedVersionAlertType, PrismaService } from "../../prisma";
import { ResourceService } from "../resource/resource.service";
import { CreateOutdatedVersionAlertArgs } from "./dto/CreateOutdatedVersionAlertArgs";
import { EnumOutdatedVersionAlertStatus } from "./dto/EnumOutdatedVersionAlertStatus";
import { FindManyOutdatedVersionAlertArgs } from "./dto/FindManyOutdatedVersionAlertArgs";
import { FindOneOutdatedVersionAlertArgs } from "./dto/FindOneOutdatedVersionAlertArgs";
import { OutdatedVersionAlert } from "./dto/OutdatedVersionAlert";
import { AmplicationError } from "../../errors/AmplicationError";
import { EnumResourceType } from "../resource/dto/EnumResourceType";
import { UpdateOutdatedVersionAlertArgs } from "./dto/UpdateOutdatedVersionAlertArgs";
import { User } from "../../models";
import { PluginInstallationService } from "../pluginInstallation/pluginInstallation.service";
import { KafkaProducerService } from "@amplication/util/nestjs/kafka";
import { KAFKA_TOPICS, TechDebt } from "@amplication/schema-registry";
import { ConfigService } from "@nestjs/config";
import { Env } from "../../env";
import { encryptString } from "../../util/encryptionUtil";
import { ProjectService } from "../project/project.service";

@Injectable()
export class OutdatedVersionAlertService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ResourceService))
    private readonly resourceService: ResourceService,
    @Inject(AmplicationLogger)
    private readonly logger: AmplicationLogger,
    private readonly pluginInstallationService: PluginInstallationService,
    private readonly kafkaProducerService: KafkaProducerService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ProjectService))
    private readonly projectService: ProjectService
  ) {}

  /**
   * create function creates a new outdatedVersionAlert for given resource in the DB
   * @returns the outdatedVersionAlert object that return after prisma.outdatedVersionAlert.create
   */
  async create(
    args: CreateOutdatedVersionAlertArgs
  ): Promise<OutdatedVersionAlert> {
    //update all previous alerts for the same resource and type that are still in status "new" to be canceled
    await this.prisma.outdatedVersionAlert.updateMany({
      where: {
        resourceId: args.data.resource.connect.id,
        blockId: args.data.block?.connect?.id,
        type: args.data.type,
        status: EnumOutdatedVersionAlertStatus.New,
      },
      data: {
        status: EnumOutdatedVersionAlertStatus.Canceled,
      },
    });

    const outdatedVersionAlert = await this.prisma.outdatedVersionAlert.create({
      ...args,
      data: {
        ...args.data,
        status: EnumOutdatedVersionAlertStatus.New,
      },
    });

    return outdatedVersionAlert;
  }

  async resolvesServiceTemplateUpdated({
    resourceId,
  }: {
    resourceId: string;
  }): Promise<void> {
    await this.prisma.outdatedVersionAlert.updateMany({
      where: {
        resourceId: resourceId,
        type: EnumOutdatedVersionAlertType.TemplateVersion,
        status: EnumOutdatedVersionAlertStatus.New,
      },
      data: {
        status: EnumOutdatedVersionAlertStatus.Resolved,
      },
    });
  }

  async count(args: FindManyOutdatedVersionAlertArgs): Promise<number> {
    return this.prisma.outdatedVersionAlert.count(args);
  }

  async findMany(
    args: FindManyOutdatedVersionAlertArgs
  ): Promise<OutdatedVersionAlert[]> {
    return this.prisma.outdatedVersionAlert.findMany({
      ...args,
      where: {
        ...args.where,
        resource: {
          ...args.where?.resource,
          deletedAt: null,
          archived: { not: true },
        },
      },
    });
  }

  async findOne(
    args: FindOneOutdatedVersionAlertArgs
  ): Promise<OutdatedVersionAlert | null> {
    return this.prisma.outdatedVersionAlert.findUnique(args);
  }

  async triggerAlertsForTemplateVersion(
    templateResourceId: string,
    outdatedVersion: string,
    latestVersion: string,
    userId: string
  ) {
    const template = await this.resourceService.resource({
      where: {
        id: templateResourceId,
      },
    });

    if (!template) {
      throw new AmplicationError(
        `Cannot trigger alerts. Template with id ${templateResourceId} not found`
      );
    }

    if (template.resourceType !== EnumResourceType.ServiceTemplate) {
      throw new AmplicationError(
        `Cannot trigger alerts. Resource with id ${templateResourceId} is not a template`
      );
    }

    const workspace = await this.resourceService.getResourceWorkspace(
      templateResourceId
    );

    const project = await this.projectService.findFirst({
      where: { id: template.projectId },
    });
    //find all services using this template
    const services = await this.resourceService.resources({
      where: {
        serviceTemplateId: templateResourceId,
        project: {
          id: template.projectId,
        },
      },
    });

    if (outdatedVersion !== null) {
      //create outdatedVersionAlert for each service
      for (const service of services) {
        const currentTemplateVersion =
          await this.resourceService.getServiceTemplateSettings(
            service.id,
            null
          );

        const alert = await this.create({
          data: {
            resource: {
              connect: {
                id: service.id,
              },
            },
            type: EnumOutdatedVersionAlertType.TemplateVersion,
            outdatedVersion: currentTemplateVersion.version,
            latestVersion,
          },
        });

        this.kafkaProducerService
          .emitMessage(KAFKA_TOPICS.TECH_DEBT_CREATED_TOPIC, <
            TechDebt.KafkaEvent
          >{
            key: {},
            value: {
              resourceId: service.id,
              resourceName: service.name,
              workspaceId: workspace.id,
              projectId: template.projectId,
              createdAt: Date.now(),
              techDebtId: alert.id,
              envBaseUrl: this.configService.get<string>(Env.CLIENT_HOST),
              externalId: encryptString(userId),
              resourceType: service.resourceType,
              projectName: project.name,
              alertType: alert.type,
              alertInitiator: template.name,
            },
          })
          .catch((error) =>
            this.logger.error(
              `Failed to queue tech debt for service ${service.id}`,
              error
            )
          );
      }
    }
  }

  /**
   * Triggers alerts for all plugin installations in the given project with the given plugin id
   * when the updated plugin is a public plugin - we need to run this function for all projects (or maybe run it once without the projectId)
   *
   * @param projectId - the project id
   * @param pluginId - the plugin id e.g. "plugin-aws-s3"
   * @param newVersion - the new version of the plugin e.g. "1.0.0"
   */
  async triggerAlertsForNewPluginVersion(
    projectId: string,
    pluginId: string,
    newVersion: string,
    userId: string
  ) {
    //get all plugin installations in the project with the pluginId
    const pluginInstallations =
      await this.pluginInstallationService.findPluginInstallationByPluginId(
        pluginId,
        {
          resource: {
            project: {
              id: projectId,
            },
          },
        }
      );

    const project = await this.projectService.findFirst({
      where: { id: projectId },
    });

    //create outdatedVersionAlert for each service
    for (const pluginInstallation of pluginInstallations) {
      const alert = await this.create({
        data: {
          resource: {
            connect: {
              id: pluginInstallation.resourceId,
            },
          },
          block: {
            connect: {
              id: pluginInstallation.id,
            },
          },
          type: EnumOutdatedVersionAlertType.PluginVersion,
          outdatedVersion: pluginInstallation.version,
          latestVersion: newVersion,
        },
      });

      const resource = await this.resourceService.resource({
        where: { id: alert.resourceId },
      });

      this.kafkaProducerService
        .emitMessage(KAFKA_TOPICS.TECH_DEBT_CREATED_TOPIC, <
          TechDebt.KafkaEvent
        >{
          key: {},
          value: {
            resourceId: pluginInstallation.resourceId,
            resourceName: resource.name,
            workspaceId: project.workspaceId,
            projectId: projectId,
            createdAt: Date.now(),
            techDebtId: alert.id,
            envBaseUrl: this.configService.get<string>(Env.CLIENT_HOST),
            externalId: encryptString(userId),
            resourceType: resource.resourceType,
            projectName: project.name,
            alertType: alert.type,
            alertInitiator: pluginInstallation.displayName,
          },
        })
        .catch((error) =>
          this.logger.error(
            `Failed to queue tech debt for plugin ${pluginInstallation.id}`,
            error
          )
        );
    }
  }

  async update(
    args: UpdateOutdatedVersionAlertArgs,
    user: User
  ): Promise<OutdatedVersionAlert> {
    //todo: add tracking for changes (use action log?)

    return this.prisma.outdatedVersionAlert.update(args);
  }
}
